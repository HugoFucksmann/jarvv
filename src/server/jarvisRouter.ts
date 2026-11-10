/**
 * JARVIS Core — API HTTP de las tareas (`/api/jarvis/*`). El contrato para quien la consume está en `JARVIS_API.md`.
 *
 * El router solo valida la entrada y traduce: toda la lógica vive en `TaskManager`. Las respuestas de error son siempre
 * `{ error: string }`: 400 entrada inválida, 404 tarea inexistente, 409 la tarea no espera eso.
 */

import express from 'express';
import { BUDGET } from '../core/budget.ts';
import { ConfigManager, LAUNCH_ONLY_KEYS } from '../core/config.ts';
import { getUserEnvironment } from '../core/environment.ts';
import { readTraceFile, TRACE_FILES } from '../core/trace/files.ts';
import type { TraceFile } from '../core/trace/files.ts';
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

/** Quita de un parche los campos que definen el proceso de un servidor MCP (`LAUNCH_ONLY_KEYS`): solo se editan en el archivo. */
export function withoutLaunchFields(body: Record<string, unknown>): Record<string, unknown> {
  const patch = { ...body };
  for (const server of ['desktopCommanderMcp', 'freeSearchMcp']) {
    const value = patch[server];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const rest = { ...(value as Record<string, unknown>) };
    const ignored = LAUNCH_ONLY_KEYS.filter((key) => key in rest);
    for (const key of ignored) delete rest[key];
    if (ignored.length > 0) console.warn(`[Config] '${server}': se ignoran ${ignored.join(', ')} (solo se cambian en jarvis-config.json).`);
    patch[server] = rest;
  }
  return patch;
}

/** Bytes que un cliente SSE puede tener pendientes de leer antes de que se lo desconecte. */
const SSE_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

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

  // Lecturas para la UI (solo lectura, sin efecto en el motor).
  // Texto completo de una ref de la tarea (`calls[].ref`): `text/plain`.
  router.get('/tasks/:taskId/refs/:refId', async (req, res) => {
    let result: Awaited<ReturnType<TaskManager['readRef']>>;
    try {
      result = await tasks.readRef(req.params.taskId, req.params.refId);
    } catch (err: unknown) {
      return void res.status(500).json({ error: err instanceof Error ? err.message : 'Error al leer la referencia.' });
    }
    if (result === 'unknown_task') return void res.status(404).json({ error: 'Tarea no encontrada.' });
    if (result === 'unknown_ref') return void res.status(404).json({ error: 'Referencia no encontrada.' });
    if (result === 'unavailable') return void res.status(404).json({ error: 'El resultado guardado ya no está disponible.' });
    res.type('text/plain').send(result.text);
  });

  // Traza de una tarea terminada: `?format=summary` (Markdown, por defecto) o `json`.
  router.get('/tasks/:taskId/trace', (req, res) => {
    const format = text(req.query.format) ?? 'summary';
    if (!Object.hasOwn(TRACE_FILES, format)) return void res.status(400).json({ error: `format inválido; use ${Object.keys(TRACE_FILES).join(' o ')}.` });
    const body = readTraceFile(ConfigManager.getConfig().tracePath, req.params.taskId, format as TraceFile);
    if (body === null) return void res.status(404).json({ error: 'No hay traza para esa tarea (sigue en curso o la traza está desactivada).' });
    res.type(format === 'json' ? 'application/json' : 'text/markdown').send(body);
  });

  // Datos de esta PC (sistema operativo y carpetas del usuario) y la hora del servidor.
  router.get('/environment', async (_req, res) => {
    try {
      res.json({ ...(await getUserEnvironment()), now: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Error al consultar el entorno.' });
    }
  });

  // Topes del motor, para mostrar el progreso (paso 3 de 20, llamada 2 de 6).
  router.get('/limits', (_req, res) => {
    const { maxSteps, maxReplans, maxEscalations, maxItemFailures, maxCallsPerStep, maxRepeatsPerStep, maxReviewRejectionsPerStep, maxUserRejectionsPerStep, maxQuestionsPerStep } = BUDGET;
    res.json({ maxSteps, maxReplans, maxEscalations, maxItemFailures, maxCallsPerStep, maxRepeatsPerStep, maxReviewRejectionsPerStep, maxUserRejectionsPerStep, maxQuestionsPerStep });
  });

  // Eventos en tiempo real (SSE): un mensaje `data: <TaskEvent>` por evento.
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Un cliente que no lee no puede hacer crecer la memoria del servidor: pasado el tope de bytes sin enviar, se lo desconecta.
    const send = (chunk: string): void => {
      if (res.writableLength > SSE_MAX_BUFFERED_BYTES) {
        res.destroy();
        return;
      }
      res.write(chunk);
    };
    const unsubscribe = tasks.addEventListener((event) => send(`data: ${JSON.stringify(event)}\n\n`));
    const keepAlive = setInterval(() => send(': ping\n\n'), 15000);
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
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      return void res.status(400).json({ error: 'Se requiere un objeto JSON con las claves a cambiar.' });
    }
    res.json(ConfigManager.updateConfig(withoutLaunchFields(req.body) as Parameters<typeof ConfigManager.updateConfig>[0]));
  });

  return router;
}