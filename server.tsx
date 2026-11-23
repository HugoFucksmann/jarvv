/**
 * JARVIS Core — Servidor Node.js full-stack y host del runtime.
 *
 * - El navegador (React) habla con JARVIS Core por HTTP en /api/jarvis/*.
 * - Las herramientas externas hablan con los endpoints MCP en /api/mcp/* o /mcp/*.
 * - JarvisCore corre solo en el backend Node.js.
 * - SIGINT/SIGTERM cierran los servidores MCP y sus árboles de procesos hijos.
 * - Es la raíz de composición: el único lugar que conoce las implementaciones concretas de los motores.
 */

import 'dotenv/config';
import { parse as parseDotenv } from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FreeSearchMCPServer } from './src/core/mcp/freeSearchMcp.ts';
import type { IMCPServer } from './src/core/mcp/types.ts';
import { DiscoveryEngine } from './src/core/mcp/discovery.ts';
import { Decision20Engine } from './src/core/models/decision.ts';
import { QwenEngine } from './src/core/models/qwen.ts';
import { TaskManager } from './src/core/tasks.ts';
import { createEngineServices, memoryFileOf } from './src/core/engine/services.ts';
import { createJsonMemoryProvider } from './src/memory/index.ts';
import { apiErrorHandler, createJarvisRouter } from './src/server/jarvisRouter.ts';
import { createMcpRouter } from './src/server/mcpRouter.ts';
import { getUserEnvironment } from './src/core/environment.ts';
import { ConfigManager } from './src/core/config.ts';
import type { ConfigSource } from './src/core/config.ts';
import { warmUpModels } from './src/core/models/warmup.ts';
import { startRetention } from './src/core/retention.ts';
import { SystemProvider } from './src/tools/system/systemProvider.ts';
import { FilesReadProvider } from './src/tools/files_read/filesReadProvider.ts';
import { FilesWriteProvider } from './src/tools/files_write/filesWriteProvider.ts';
import { MultimediaProvider } from './src/tools/multimedia/multimediaProvider.ts';
import { TerminalProvider } from './src/tools/terminal/terminalProvider.ts';
import { WebSearchProvider } from './src/tools/web/webSearchProvider.ts';
import { isLoopbackHost, localOnly, proxyHostAllowed } from './src/server/localOnly.ts';
import { startTelegram } from './src/telegram/bot.ts';
import { telegramConfigFromEnv } from './src/telegram/config.ts';
import type { VoiceConfig } from './src/voice/tts.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Variables que `dotenv/config` cargó de `.env` (las que tienen en el entorno el mismo valor que en el archivo): son de Jarvis, no del usuario, y los
 * comandos de `run_command` no las heredan. Sin `.env`, ninguna.
 */
function dotenvKeys(): string[] {
  try {
    const file = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(file)) return [];
    const parsed = parseDotenv(fs.readFileSync(file));
    return Object.keys(parsed).filter((key) => process.env[key] === parsed[key]);
  } catch {
    return [];
  }
}

/** Secretos de voz y Telegram: los comandos de `run_command` no los heredan aunque vengan del entorno y no de `.env`. */
const SECRET_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'HF_TOKEN'];

/** La API local no tiene autenticación: por defecto solo se escucha en loopback. Para sandboxes con proxy (AI Studio Build) se define `ALLOW_PROXY_HOST=1`. */
function assertListenable(host: string): void {
  if (proxyHostAllowed() || isLoopbackHost(host)) return;
  throw new Error(
    `[Security] HOST='${host}' no es loopback (use 127.0.0.1, localhost o ::1). ` +
    'La API local no tiene autenticación; para un sandbox con proxy defina ALLOW_PROXY_HOST=1.',
  );
}

/**
 * Los servidores de herramientas: el MCP de búsqueda libre y los proveedores nativos (`src/tools/`), módulos en proceso que implementan la misma interfaz.
 * Los comandos de terminal no heredan los secretos que Jarvis cargó de `.env` (RC-16).
 */
function buildServers(getConfig: ConfigSource, decisionEngine: Decision20Engine): Record<string, IMCPServer> {
  return {
    free_search: new FreeSearchMCPServer(getConfig),
    jarvis_system: new SystemProvider({
      allowedDirectories: () => getConfig().allowedDirectories,
      environment: getUserEnvironment,
      selfPid: process.pid,
      parentPid: process.ppid,
    }),
    jarvis_files_read: new FilesReadProvider({
      allowedDirectories: () => getConfig().allowedDirectories,
      environment: getUserEnvironment,
    }),
    jarvis_files_write: new FilesWriteProvider({
      allowedDirectories: () => getConfig().allowedDirectories,
      environment: getUserEnvironment,
    }),
    jarvis_multimedia: new MultimediaProvider(),
    jarvis_terminal: new TerminalProvider({
      envRemove: [...dotenvKeys(), ...SECRET_KEYS],
      allowedDirectories: () => getConfig().allowedDirectories,
      waitSec: () => ({ default: getConfig().runCommandDefaultWaitSec, max: getConfig().runCommandMaxWaitSec }),
    }),
    // El 2B de las decisiones puntúa los fragmentos de `web_search` solo si la configuración lo enciende (se lee en cada llamada).
    jarvis_web: new WebSearchProvider({
      allowedDirectories: () => getConfig().allowedDirectories,
      environment: getUserEnvironment,
      judge: () => (getConfig().webSearchUseJudge ? decisionEngine : undefined),
      judgeTimeoutMs: () => getConfig().webJudgeTimeoutMs,
    }),
  };
}

interface ShutdownDeps {
  readonly servers: Record<string, IMCPServer>;
  readonly tasks: TaskManager;
  readonly getConfig: ConfigSource;
  /** Los apagadores que dependen de lo que se haya arrancado (retención, Telegram): se consultan al cerrar. */
  readonly stoppers: () => ReadonlyArray<(() => void) | undefined>;
}

/** SIGINT/SIGTERM: cancela las tareas, espera sus cierres y apaga los servidores y sus procesos hijos. Un segundo aviso no repite el cierre. */
function installGracefulShutdown({ servers, tasks, getConfig, stoppers }: ShutdownDeps): void {
  let isShuttingDown = false;
  const cleanShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    // Si algún servidor MCP no cierra, un segundo Ctrl+C no haría nada (isShuttingDown): salida forzada.
    setTimeout(() => {
      console.warn('[Host] El cierre excedió 5 s; saliendo de forma forzada.');
      process.exit(1);
    }, 5000).unref();
    console.log(`\n[Host] Señal ${signal} recibida. Finalizando servidores MCP y procesos hijos...`);
    for (const stop of stoppers()) stop?.();
    tasks.cancelAll();
    // Cada tarea cancelada cierra sus procesos en segundo plano (necesita los servidores vivos) y escribe su traza: se espera un momento.
    await tasks.drain(getConfig().shutdownDrainMs);

    // En paralelo: un servidor colgado no consume el plazo de los demás.
    const results = await Promise.allSettled(Object.values(servers).map((server) => server.close?.()));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.warn(`[Host] Error cerrando servidor '${Object.keys(servers)[i]}':`, result.reason);
      }
    });

    console.log('[Host] Todos los subprocesos MCP han finalizado limpiamente.');
    process.exit(0);
  };

  process.on('SIGINT', () => cleanShutdown('SIGINT'));
  process.on('SIGTERM', () => cleanShutdown('SIGTERM'));
}

/** La interfaz: en desarrollo, el middleware de Vite; en producción, lo compilado en `dist/`. */
async function mountFrontend(app: express.Express): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
    return;
  }

  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });

  app.use(vite.middlewares);

  // Fallback: index.html de Vite para cualquier otra ruta
  app.use('*', async (req, res, next) => {
    try {
      const template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (e: unknown) {
      if (e instanceof Error) vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}

async function main() {
  // En sandboxes con proxy (p. ej. AI Studio Build), `PORT` suele coincidir con `NGINX_PORT` (8080) mientras el backend debe escuchar en `DEFAULT_APP_PORT` (3000).
  const rawPort =
    process.env.DEFAULT_APP_PORT ??
    (process.env.PORT && process.env.PORT !== process.env.NGINX_PORT ? process.env.PORT : undefined);
  const PORT = Number(rawPort) || 3000;
  const HOST = process.env.HOST || '127.0.0.1';
  assertListenable(HOST);

  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(localOnly());

  const getConfig: ConfigSource = () => ConfigManager.getConfig();

  const decisionEngine = new Decision20Engine(getConfig);
  const servers = buildServers(getConfig, decisionEngine);
  const discoveryEngine = new DiscoveryEngine(servers);
  const llm = new QwenEngine(getConfig);

  // La memoria de hechos del usuario (`data/memory.json`) la elige esta raíz de composición; el motor solo recibe el puerto (`MemoryProvider`).
  const services = createEngineServices(getConfig, { memoryProvider: createJsonMemoryProvider(memoryFileOf(getConfig())) });
  const tasks = new TaskManager({ decision: decisionEngine, discovery: discoveryEngine, llm }, getConfig, services);

  // Limpieza por antigüedad de las refs y las trazas (`retentionDays`): al arrancar y cada 6 horas.
  const stopRetention = startRetention(getConfig, () => tasks.taskIds());

  // Voz: la configuración se lee en cada uso (se cambia en caliente desde la interfaz). `ui`: ¿la interfaz lee las respuestas?; `telegram`: ¿notas de voz?
  const voiceFor = (target: 'ui' | 'telegram'): VoiceConfig | null => {
    const cfg = getConfig();
    if (!(target === 'ui' ? cfg.voiceEnabled : cfg.telegramVoice)) return null;
    return { voice: cfg.voiceName, baseUrl: cfg.voiceUrl };
  };

  let stopTelegram: (() => void) | undefined;
  installGracefulShutdown({ servers, tasks, getConfig, stoppers: () => [stopRetention, stopTelegram] });

  app.use('/api/jarvis', createJarvisRouter(tasks, discoveryEngine, () => voiceFor('ui'), () => getConfig().sseKeepAliveMs));
  app.use(['/api/mcp', '/mcp'], createMcpRouter(discoveryEngine));

  // Lo que cuelga de un prefijo de API y no coincide con ninguna ruta nunca llega al frontend.
  app.use(['/api', '/mcp'], (req, res) => {
    res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.` });
  });
  app.use(['/api', '/mcp'], apiErrorHandler);

  await mountFrontend(app);

  // Datos de esta PC (carpetas del usuario): se consultan ahora y no en la primera tarea; la primera tarea espera la misma promesa.
  void getUserEnvironment();
  // Precalienta los dos modelos (carga en GPU + `keep_alive`) sin bloquear el arranque; un fallo solo se registra.
  void warmUpModels(getConfig);

  app.listen(PORT, HOST, () => {
    console.log(`JARVIS Core authoritative full-stack host running on http://${HOST}:${PORT}`);
  });

  // Telegram (opcional): segunda vía de entrada de tareas desde un único chat privado. Habla con esta misma API por loopback.
  const telegram = telegramConfigFromEnv(process.env, PORT);
  if (telegram.config) {
    for (const warning of telegram.warnings) console.warn(`[Telegram] ${warning}`);
    stopTelegram = startTelegram({
      cfg: telegram.config,
      getVoice: () => voiceFor('telegram'),
      interruptedOnStartup: tasks.interruptedOnStartup(),
    });
  } else {
    console.log(`[Telegram] Desactivado: ${telegram.reason}.`);
  }

  // Arranque de los servidores MCP en paralelo desde ya: tardan unos 2-3 s en estar listos y, si esperan a la primera petición, la paga la
  // primera carga de la interfaz o la primera tarea. Un fallo no detiene nada: queda como servidor no disponible (se reintenta con un refresco).
  const warmUpStart = Date.now();
  void discoveryEngine.discoverAll().then((tools) => {
    const summary = Object.entries(tools).map(([name, list]) => `${name}: ${list.length}`).join(', ');
    console.log(`[Host] Servidores MCP listos en ${((Date.now() - warmUpStart) / 1000).toFixed(1)} s (${summary}).`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
