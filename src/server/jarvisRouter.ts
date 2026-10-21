import express from 'express';
import { JarvisCore } from '../core/core.ts';
import { DiscoveryEngine } from '../core/mcp/discovery.ts';
import { PendingApproval } from '../core/types.ts';
import { toWireTask } from '../core/taskWire.ts';
import { ConfigManager } from '../core/config.ts';

function serializePendingApproval(pending: PendingApproval | null) {
  if (!pending) return null;
  return {
    id: pending.id,
    stepId: pending.stepId,
    mcp: pending.mcp,
    tool: pending.tool,
    capability: pending.capability,
    args: pending.args,
    reason: pending.reason,
  };
}

function resolveTargetTaskId(jarvisCore: JarvisCore, taskId?: string): string | undefined {
  if (taskId) return taskId;
  const allTasks = jarvisCore.getAllTasks();
  return allTasks[allTasks.length - 1]?.id;
}

export function createJarvisRouter(jarvisCore: JarvisCore, discoveryEngine: DiscoveryEngine): express.Router {
  const router = express.Router();

  // Iniciar tarea
  router.post(['/process', '/task'], async (req, res) => {
    try {
      const { message, mode } = req.body;
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Mensaje requerido.' });
      }
      const task = await jarvisCore.initiateTask(message.trim(), mode || 'NORMAL');
      res.json({ task });
    } catch (err: any) {
      console.error('[JARVIS Task Initiation Error]', err);
      res.status(500).json({ error: err.message || 'Error al iniciar tarea.' });
    }
  });

  // Cancelar tarea
  router.post('/cancel', (req, res) => {
    const { taskId } = req.body;
    if (taskId) {
      jarvisCore.cancelTask(taskId);
    } else {
      const allTasks = jarvisCore.getAllTasks();
      const running = allTasks.find((t) => t.state === 'RUNNING');
      if (running) jarvisCore.cancelTask(running.id);
    }
    res.json({ ok: true });
  });

  // Confirmar, rechazar o solicitar modificación de plan (modo PLAN §3.2.4)
  router.post('/confirm-plan', async (req, res) => {
    try {
      const { taskId, action, feedback, reason } = req.body;
      const targetId = resolveTargetTaskId(jarvisCore, taskId);

      if (!targetId) {
        return res.status(404).json({ error: 'No se encontró ninguna tarea activa.' });
      }

      if (action === 'reject') {
        jarvisCore.rejectPlan(targetId, reason);
        return res.json({ ok: true, action: 'reject' });
      }

      if (action === 'modify') {
        await jarvisCore.modifyPlan(targetId, feedback || reason || 'Ajustar plan.');
        return res.json({ ok: true, action: 'modify' });
      }

      jarvisCore.confirmPlan(targetId);
      res.json({ ok: true, action: 'confirm' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Error al procesar el plan.' });
    }
  });

  // Rechazar plan formalmente
  router.post('/reject-plan', (req, res) => {
    const { taskId, reason } = req.body;
    const targetId = resolveTargetTaskId(jarvisCore, taskId);
    if (targetId) {
      jarvisCore.rejectPlan(targetId, reason);
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'No se encontró ninguna tarea activa.' });
    }
  });

  // Solicitar modificación de plan
  router.post('/modify-plan', async (req, res) => {
    try {
      const { taskId, feedback } = req.body;
      const targetId = resolveTargetTaskId(jarvisCore, taskId);
      if (targetId) {
        await jarvisCore.modifyPlan(targetId, feedback || 'Ajustar pasos según solicitud.');
        res.json({ ok: true });
      } else {
        res.status(404).json({ error: 'No se encontró ninguna tarea activa.' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Error al modificar el plan.' });
    }
  });

  // Responder a pregunta interactiva (WAITING_INPUT user_answer)
  router.post('/user-answer', (req, res) => {
    const { taskId, answer } = req.body;
    const targetId = resolveTargetTaskId(jarvisCore, taskId);
    if (targetId && typeof answer === 'string') {
      jarvisCore.provideUserAnswer(targetId, answer);
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'Se requiere taskId y respuesta válida.' });
    }
  });

  // Aprobar operación con compuerta de seguridad Guard
  router.post('/approve', (req, res) => {
    const { taskId } = req.body;
    const pending = jarvisCore.getPendingApproval(taskId);
    if (pending) {
      pending.onApprove();
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'No se encontró ninguna aprobación pendiente.' });
    }
  });

  // Rechazar operación con compuerta de seguridad Guard
  router.post('/deny', (req, res) => {
    const { taskId, reason } = req.body;
    const pending = jarvisCore.getPendingApproval(taskId);
    if (pending) {
      pending.onDeny(reason);
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'No se encontró ninguna aprobación pendiente.' });
    }
  });

  // Consultar estado actual / snapshot reactivo de JARVIS
  router.get('/state', async (req, res) => {
    try {
      const taskId = req.query.taskId as string | undefined;
      const allTasks = jarvisCore.getAllTasks();
      const task = taskId ? jarvisCore.getTask(taskId) : allTasks[allTasks.length - 1] || null;
      const pending = jarvisCore.getPendingApproval(task?.id);
      const tools = await discoveryEngine.discoverAll().catch(() => ({}));

      res.json({
        task,
        pendingApproval: serializePendingApproval(pending),
        allTasks: allTasks.map(toWireTask),
        discoveredTools: tools,
        unavailableServers: discoveryEngine.getUnavailableServers(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stream Server-Sent Events (SSE) para eventos de Core en tiempo real
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const unsubscribe = jarvisCore.addEventListener((event) => {
      const currentTask = jarvisCore.getTask(event.taskId);
      const pending = jarvisCore.getPendingApproval(event.taskId);
      const payload = JSON.stringify({
        event,
        task: toWireTask(currentTask),
        pendingApproval: serializePendingApproval(pending),
      });
      res.write(`data: ${payload}\n\n`);
    });

    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // Refrescar catálogo de Discovery dinámicamente
  router.all(['/refresh-discovery', '/discovery'], async (_req, res) => {
    try {
      const tools = await discoveryEngine.discoverAll(true);
      res.json({ tools, unavailableServers: discoveryEngine.getUnavailableServers() });
    } catch (err: any) {
      res.json({ tools: {}, error: err.message });
    }
  });



  // Configuración de endpoints externos
  router.get('/config', (_req, res) => {
    res.json(ConfigManager.getConfig());
  });

  router.post('/config', (req, res) => {
    const updated = ConfigManager.updateConfig(req.body);
    res.json(updated);
  });

  return router;
}
