/**
 * JARVIS Core — API HTTP de las tareas (`/api/jarvis/*`). El contrato para quien la consume está en `docs/api/JARVIS_API.md`.
 *
 * El router solo valida la entrada y traduce: toda la lógica vive en `TaskManager`. Las respuestas de error son siempre
 * `{ error: string }`: 400 entrada inválida, 404 tarea inexistente, 409 la tarea no espera eso.
 */

import express from 'express';
import { limitValues } from '../core/engine/limits.ts';
import { MAX_ACTIVE_TASKS, MAX_SSE_CLIENTS } from '../core/types/limits.ts';
import { ConfigManager, FILE_ONLY_KEYS, LAUNCH_ONLY_KEYS, type JarvisConfig, type StdioServerConfig } from '../core/config.ts';
import { getUserEnvironment } from '../core/environment.ts';
import { readTraceFile, TRACE_FILES } from '../core/trace/files.ts';
import type { TraceFile } from '../core/trace/files.ts';
import type { ControlResult, TaskManager } from '../core/tasks.ts';
import type { DiscoveryEngine } from '../core/mcp/discovery.ts';
import { TASK_MODES } from '../core/ctx/index.ts';
import { streamSpeech } from '../voice/tts.ts';
import { TIMEOUT_DEFAULTS } from '../core/timeouts.ts';
import type { VoiceConfig } from '../voice/tts.ts';
import type { TaskMode } from '../core/ctx/index.ts';

/** Texto no vacío (recortado) o `undefined`. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isMode(value: unknown): value is TaskMode {
  return typeof value === 'string' && (TASK_MODES as readonly string[]).includes(value);
}

/**
 * Quita de un parche lo que solo se edita en el archivo: los campos que definen el proceso de un servidor MCP (`LAUNCH_ONLY_KEYS`) y las
 * carpetas donde Jarvis escribe y borra (`FILE_ONLY_KEYS`).
 */
export function withoutLaunchFields(body: Record<string, unknown>): Record<string, unknown> {
  const patch = { ...body };
  for (const key of FILE_ONLY_KEYS) {
    if (!(key in patch)) continue;
    delete patch[key];
    console.warn(`[Config] se ignora '${key}' (solo se cambia en jarvis-config.json).`);
  }
  for (const server of ['freeSearchMcp']) {
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

function omitServerEnv(server: StdioServerConfig): StdioServerConfig {
  const { env: _env, ...rest } = server;
  return rest;
}

/**
 * Quita `env` de los servidores MCP antes de enviar la configuración por HTTP (`GET/POST /config`): evita exponer variables
 * de entorno o credenciales configuradas para subprocesos. La UI no lee `env`, y `POST /config` lo conserva en disco vía `withoutLaunchFields`.
 */
export function sanitizeConfigForHttp(config: JarvisConfig): JarvisConfig {
  return {
    ...config,
    freeSearchMcp: omitServerEnv(config.freeSearchMcp),
  };
}

/**
 * Manejador de errores de `/api` y `/mcp`: traduce errores de `express.json()` (`entity.too.large` -> 413,
 * JSON malformado -> 400) en lugar de devolver 500.
 */
export const apiErrorHandler: express.ErrorRequestHandler = (err, _req, res, _next) => {
  const type = typeof err === 'object' && err !== null && 'type' in err ? (err as { type?: unknown }).type : undefined;
  if (type === 'entity.too.large') {
    return void res.status(413).json({ error: 'El cuerpo JSON supera el límite permitido.' });
  }
  if (err instanceof SyntaxError || type === 'entity.parse.failed') {
    return void res.status(400).json({ error: 'JSON inválido en el cuerpo de la petición.' });
  }
  console.error('[API Error]', err);
  res.status(500).json({ error: err instanceof Error && err.message ? err.message : 'Error interno en API' });
};

/** Bytes que un cliente SSE puede tener pendientes de leer antes de que se lo desconecte. */
const SSE_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/** Tope del texto que se sintetiza en un request (una respuesta final larga ya es mucho audio). */
const TTS_MAX_CHARS = 20000;

/**
 * `getVoice`: la configuración de voz vigente (se lee en cada request) o `null` si está apagada. Sin ella `POST /tts` responde 503.
 */
export function createJarvisRouter(tasks: TaskManager, discoveryEngine: DiscoveryEngine, getVoice: () => VoiceConfig | null = () => null, getSseKeepAliveMs: () => number = () => TIMEOUT_DEFAULTS.sseKeepAliveMs): express.Router {
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
  /**
   * `strict`: una decisión (aprobar, rechazar, confirmar o modificar un plan) exige `taskId` y `waitId`: sin ellos se aplicaría a "la última
   * tarea" y un cliente podría aprobar a ciegas lo que no vio. Cancelar y responder una pregunta conservan el atajo.
   */
  const control = (notWaiting: string, run: (taskId: string, body: Record<string, unknown>) => ControlResult, strict = false): express.RequestHandler =>
    (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (strict && (!text(body.taskId) || !text(body.waitId))) {
        return void res.status(400).json({ error: 'Se requieren taskId y waitId: la decisión debe indicar qué tarea y qué espera resuelve.' });
      }
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
    if (tasks.activeCount() >= MAX_ACTIVE_TASKS) return void res.status(429).json({ error: `Hay ${MAX_ACTIVE_TASKS} tareas en curso; espere a que termine alguna o cancele una.` });
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
    control('La tarea no espera la confirmación de un plan.', (id, b) => tasks.approvePlan(id, text(b.waitId)), true),
  );
  router.post('/modify-plan', (req, res) => {
    const feedback = text(req.body?.feedback);
    if (!feedback) return void res.status(400).json({ error: 'Se requiere feedback.' });
    control('La tarea no espera la confirmación de un plan.', (id, b) => tasks.modifyPlan(id, feedback, text(b.waitId)), true)(req, res, () => undefined);
  });
  router.post(
    '/reject-plan',
    control('La tarea no espera la confirmación de un plan.', (id, b) => tasks.rejectPlan(id, text(b.waitId)), true),
  );

  // Mutación sensible: aprobar o rechazar (con una instrucción opcional en `reason`).
  router.post('/approve', control('La tarea no espera la aprobación de una operación.', (id, b) => tasks.approveCall(id, text(b.waitId), b.remember === true), true));
  router.post(
    '/deny',
    control('La tarea no espera la aprobación de una operación.', (id, b) => tasks.denyCall(id, text(b.reason), text(b.waitId)), true),
  );

  // Responder la pregunta abierta de la tarea (`waitId` opcional por retrocompatibilidad; si se envía, debe coincidir con `question.id`).
  router.post('/user-answer', (req, res) => {
    const answer = text(req.body?.answer);
    if (!answer) return void res.status(400).json({ error: 'Se requiere una respuesta no vacía.' });
    control('La tarea no espera una respuesta.', (id, b) => tasks.answer(id, answer, text(b.waitId)))(req, res, () => undefined);
  });

  // Estado: la tarea pedida (o la última), el listado y el catálogo de herramientas cacheado (sin bloquear en discoverAll).
  router.get('/state', (req, res) => {
    try {
      const requested = text(req.query.taskId);
      const list = tasks.list();
      const id = requested ?? list[list.length - 1]?.id;
      res.json({
        task: id ? (tasks.get?.(id) ?? null) : null,
        tasks: list,
        discoveredTools: discoveryEngine.getCachedTools?.() ?? {},
        unavailableServers: discoveryEngine.getUnavailableServers?.() ?? {},
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Error al consultar el estado.' });
    }
  });

  // Lecturas para la UI (solo lectura, sin efecto en el motor).
  // Estado completo de una tarea individual (liviano: sin listado global ni catálogo de herramientas).
  router.get('/tasks/:taskId', (req, res) => {
    try {
      const task = tasks.get(req.params.taskId);
      if (!task) return void res.status(404).json({ error: 'Tarea no encontrada.' });
      res.json(task);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Error al consultar la tarea.' });
    }
  });

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

  // Traza de una tarea terminada: `?format=summary` (Markdown, por defecto), `json` (liviana) o `full` (con entradas y salidas crudas).
  router.get('/tasks/:taskId/trace', (req, res) => {
    const format = text(req.query.format) ?? 'summary';
    if (!Object.hasOwn(TRACE_FILES, format)) return void res.status(400).json({ error: `format inválido; use ${Object.keys(TRACE_FILES).join(' o ')}.` });
    const body = readTraceFile(ConfigManager.getConfig().tracePath, req.params.taskId, format as TraceFile);
    if (body === null) return void res.status(404).json({ error: 'No hay traza para esa tarea (sigue en curso o la traza está desactivada).' });
    res.type(format === 'summary' ? 'text/markdown' : 'application/json').send(body);
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
    res.json(limitValues());
  });

  // Eventos en tiempo real (SSE): evento inicial `snapshot` seguido de eventos de tarea, todos con `id:` y `data:`.
  let sseClients = 0;
  let nextSseEventId = 1;
  router.get('/events', (req, res) => {
    if (sseClients >= MAX_SSE_CLIENTS) return void res.status(429).json({ error: 'Demasiadas conexiones de eventos abiertas.' });
    sseClients++;
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
    const sendEvent = (payload: unknown): void => {
      const id = nextSseEventId++;
      send(`id: ${id}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const requested = text(req.query.taskId);
    const list = tasks.list();
    const taskId = requested ?? list[list.length - 1]?.id;
    const unsubscribe = tasks.addEventListener((event) => sendEvent(event));
    sendEvent({
      type: 'snapshot',
      task: taskId ? (tasks.get?.(taskId) ?? null) : null,
      tasks: list,
      discoveredTools: discoveryEngine.getCachedTools?.() ?? {},
      unavailableServers: discoveryEngine.getUnavailableServers?.() ?? {},
    });

    const keepAlive = setInterval(() => send(': ping\n\n'), getSseKeepAliveMs());
    req.on('close', () => {
      sseClients--;
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // Voz: `{ text }` -> audio PCM 16-bit, mono, 24 kHz, en streaming (`audio/L16`).
  router.post('/tts', async (req, res) => {
    const input = text(req.body?.text);
    if (!input) return void res.status(400).json({ error: 'Se requiere text.' });
    if (input.length > TTS_MAX_CHARS) return void res.status(400).json({ error: `text supera ${TTS_MAX_CHARS} caracteres.` });
    const voice = getVoice();
    if (!voice) return void res.status(503).json({ error: 'La voz está desactivada (voiceEnabled).' });

    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const stream = streamSpeech(input, voice, abort.signal);
      // Se espera el primer fragmento antes de las cabeceras: si el servidor TTS falla, el cliente recibe un error y no un audio vacío.
      let next = await stream.next();
      if (next.done) return void res.status(422).json({ error: 'No hay texto que sintetizar.' });
      res.setHeader('Content-Type', 'audio/L16;rate=24000;channels=1');
      res.setHeader('Cache-Control', 'no-store');
      while (!next.done && !abort.signal.aborted) {
        if (!res.write(next.value)) {
          // Espera el `drain`; el `close` también destraba (cliente que se fue). Cada espera retira el oyente que no se usó.
          await new Promise<void>((resolve) => {
            const done = (): void => {
              res.off('drain', done);
              res.off('close', done);
              resolve();
            };
            res.on('drain', done);
            res.on('close', done);
          });
        }
        next = await stream.next();
      }
      res.end();
    } catch (err: unknown) {
      if (abort.signal.aborted) return;
      // `fetch failed` esconde la causa real (ECONNREFUSED, timeout…) en `cause`.
      const cause = err instanceof Error && err.cause instanceof Error ? ` (${(err.cause as NodeJS.ErrnoException).code ?? err.cause.message})` : '';
      console.warn(`[TTS] ${err instanceof Error ? err.message : err}${cause}: ${voice.baseUrl}`);
      if (!res.headersSent) res.status(502).json({ error: 'No se pudo conectar con el servidor de voz (voiceUrl). ¿Está corriendo scripts/phonon_server.py?' });
      else res.destroy();
    }
  });

  // Refrescar el catálogo de herramientas.
  router.post('/refresh-discovery', async (_req, res) => {
    try {
      const tools = await discoveryEngine.discoverAll(true);
      res.json({ tools, unavailableServers: discoveryEngine.getUnavailableServers() });
    } catch (err: unknown) {
      res.json({ tools: {}, error: err instanceof Error ? err.message : 'Error al refrescar el catálogo.' });
    }
  });

  // Configuración de los endpoints externos.
  router.get('/config', (_req, res) => {
    res.json(sanitizeConfigForHttp(ConfigManager.getConfig()));
  });
  router.post('/config', (req, res) => {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      return void res.status(400).json({ error: 'Se requiere un objeto JSON con las claves a cambiar.' });
    }
    res.json(sanitizeConfigForHttp(ConfigManager.updateConfig(withoutLaunchFields(req.body) as Parameters<typeof ConfigManager.updateConfig>[0])));
  });

  return router;
}