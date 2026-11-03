/**
 * JARVIS Core — API HTTP de las tareas (`/api/jarvis/*`). El contrato para quien la consume está en `JARVIS_API.md`.
 *
 * El router solo valida la entrada y traduce: toda la lógica vive en `TaskManager`. Las respuestas de error son siempre
 * `{ error: string }`: 400 entrada inválida, 404 tarea inexistente, 409 la tarea no espera eso.
 */

import express from 'express';
import { ConfigManager } from '../core/config.ts';
import type { ControlResult, TaskManager } from '../core/tasks.ts';
import type { DiscoveryEngine } from '../core/mcp/discovery.ts';
import { TASK_MODES } from '../core/ctx/index.ts';
import type { TaskMode } from '../core/ctx/index.ts';

/** Texto no vacío (recortado) o `undefined`. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isMode(value: unknown): value is TaskMode {
  return typeof value === 'string' && (TASK_MODES as readonly string[]).includes(value);
}

export function createJarvisRouter(tasks: TaskManager, discoveryEngine: DiscoveryEngine): express.Router {
  const router = express.Router();

  /** `taskId` del cuerpo o, si falta, la última tarea retenida (compatibilidad con clientes de una sola tarea). */
  const targetOf = (body: unknown): string | undefined => {
    const id = text((body as { taskId?: unknown } | undefined)?.taskId);
    if (id) return id;
    const all = tasks.list();
    return all[all.length - 1]?.id;
  };

  const reply = (res: express.Response, result: ControlResult, notWaiting: string): void => {
    if (result === 'ok') res.json({ ok: true });
    else if (result === 'unknown_task') res.status(404).json({ error: 'Tarea no encontrada.' });
    else res.status(409).json({ error: notWaiting });
  };

  /** Ejecuta una orden sobre la tarea indicada; 404 si no hay ninguna. */
  const control = (notWaiting: string, run: (taskId: string, body: Record<string, unknown>) => ControlResult): express.RequestHandler =>
    (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const taskId = targetOf(body);
      if (!taskId) return void res.status(404).json({ error: 'No hay ninguna tarea.' });
      reply(res, run(taskId, body), notWaiting);
    };

  // Iniciar una tarea. `mode`: 'reactive' (por defecto) o 'deliberative' (planifica y pide confirmar el plan).
  router.post('/process', (req, res) => {
    const message = text(req.body?.message);
    if (!message) return void res.status(400).json({ error: 'Mensaje requerido.' });
    const mode = req.body?.mode ?? 'reactive';
    if (!isMode(mode)) return void res.status(400).json({ error: `Modo inválido; use ${TASK_MODES.join(' o ')}.` });
    res.json({ task: tasks.start(message, mode) });
  });

  // Cancelar. Sin `taskId`, la última tarea abierta.
  router.post('/cancel', (req, res) => {
    const explicit = text(req.body?.taskId);
    const taskId = explicit ?? [...tasks.list()].reverse().find((t) => t.state === 'running')?.id;
    if (!taskId) return void res.json({ ok: true }); // nada que cancelar
    const result = tasks.cancel(taskId);
    // Cancelar una tarea que ya terminó no es un error.
    if (result === 'not_waiting') return void res.json({ ok: true });
    reply(res, result, '');
  });

  // Plan (deliberativo): confirmar, pedir cambios (nuevo plan con la instrucción) o rechazar (cancela la tarea).
  router.post(
    '/confirm-plan',
    control('La tarea no espera la confirmación de un plan.', (id, b) => tasks.approvePlan(id, text(b.waitId))),
  );
  router.post('/modify-plan', (req, res) => {
    const feedback = text(req.body?.feedback);
    if (!feedback) return void res.status(400).json({ error: 'Se requiere feedback.' });
    control('La tarea no espera la confirmación de un plan.', (id, b) => tasks.modifyPlan(id, feedback, text(b.waitId)))(req, res, () => undefined);
  });
  router.post(
    '/reject-plan',
    control('La tarea no espera la confirmación de un plan.', (id, b) => tasks.rejectPlan(id, text(b.waitId))),
  );

  // Mutación sensible: aprobar o rechazar (con una instrucción opcional en `reason`).
  router.post('/approve', control('La tarea no espera la aprobación de una operación.', (id, b) => tasks.approveCall(id, text(b.waitId))));
  router.post(
    '/deny',
    control('La tarea no espera la aprobación de una operación.', (id, b) => tasks.denyCall(id, text(b.reason), text(b.waitId))),
  );

  // Responder la pregunta abierta de la tarea.
  router.post('/user-answer', (req, res) => {
    const answer = text(req.body?.answer);
    if (!answer) return void res.status(400).json({ error: 'Se requiere una respuesta no vacía.' });
    control('La tarea no espera una respuesta.', (id) => tasks.answer(id, answer))(req, res, () => undefined);
  });

  // Estado: la tarea pedida (o la última), el listado y el catálogo de herramientas.
  router.get('/state', async (req, res) => {
    try {
      const requested = text(req.query.taskId);
      const list = tasks.list();
      const id = requested ?? list[list.length - 1]?.id;
      const tools = await discoveryEngine.discoverAll().catch(() => ({}));
      res.json({
        task: id ? tasks.get(id) : null,
        tasks: list,
        discoveredTools: tools,
        unavailableServers: discoveryEngine.getUnavailableServers(),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Error al consultar el estado.' });
    }
  });

  // Eventos en tiempo real (SSE): un mensaje `data: <TaskEvent>` por evento.
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const unsubscribe = tasks.addEventListener((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // Refrescar el catálogo de herramientas.
  router.all('/refresh-discovery', async (_req, res) => {
    try {
      const tools = await discoveryEngine.discoverAll(true);
      res.json({ tools, unavailableServers: discoveryEngine.getUnavailableServers() });
    } catch (err: unknown) {
      res.json({ tools: {}, error: err instanceof Error ? err.message : 'Error al refrescar el catálogo.' });
    }
  });

  // Configuración de los endpoints externos.
  router.get('/config', (_req, res) => {
    res.json(ConfigManager.getConfig());
  });
  router.post('/config', (req, res) => {
    res.json(ConfigManager.updateConfig(req.body));
  });

  return router;
}