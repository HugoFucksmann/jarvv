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
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DesktopCommanderMCPServer } from './src/core/mcp/desktopCommanderMcp.ts';
import { FreeSearchMCPServer } from './src/core/mcp/freeSearchMcp.ts';
import type { IMCPServer } from './src/core/mcp/types.ts';
import { DiscoveryEngine } from './src/core/mcp/discovery.ts';
import { Decision20Engine } from './src/core/models/decision.ts';
import { QwenEngine } from './src/core/models/qwen.ts';
import { TaskManager } from './src/core/tasks.ts';
import { createJarvisRouter } from './src/server/jarvisRouter.ts';
import { createMcpRouter } from './src/server/mcpRouter.ts';
import { localOnly } from './src/server/localOnly.ts';
import { getUserEnvironment } from './src/core/environment.ts';
import { ConfigManager } from './src/core/config.ts';
import { startRetention } from './src/core/retention.ts';
import { TerminalProvider } from './src/tools/terminal/terminalProvider.ts';
import { WebSearchProvider } from './src/tools/web/webSearchProvider.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const app = express();
  app.use(express.json());

  // Acceso solo local (Host y Origin): ver `src/server/localOnly.ts`.
  app.use(localOnly());

  const getConfig = () => ConfigManager.getConfig();

  const desktopServer = new DesktopCommanderMCPServer(getConfig);
  const freeSearchServer = new FreeSearchMCPServer(getConfig);

  // El 2B de las decisiones puntúa los fragmentos de `web_search` solo si la configuración lo enciende (se lee en cada llamada).
  const decisionEngine = new Decision20Engine(getConfig);
  const servers: Record<string, IMCPServer> = {
    desktop_commander: desktopServer,
    free_search: freeSearchServer,
    // Proveedores nativos (`src/tools/`): módulos en proceso que implementan la misma interfaz que los servidores MCP.
    jarvis_terminal: new TerminalProvider(),
    jarvis_web: new WebSearchProvider({ judge: () => (getConfig().webSearchUseJudge ? decisionEngine : undefined) }),
  };

  const discoveryEngine = new DiscoveryEngine(servers);
  const llm = new QwenEngine(getConfig);

  const tasks = new TaskManager({ decision: decisionEngine, discovery: discoveryEngine, llm }, getConfig);

  // Limpieza por antigüedad de las refs y las trazas (`retentionDays`): al arrancar y cada 6 horas.
  const stopRetention = startRetention(getConfig, () => tasks.taskIds());

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
    stopRetention();
    tasks.cancelAll();
    // Cada tarea cancelada cierra sus procesos en segundo plano (necesita los servidores vivos) y escribe su traza: se espera un momento.
    await tasks.drain(3000);

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

  app.use('/api/jarvis', createJarvisRouter(tasks, discoveryEngine));
  app.use(['/api/mcp', '/mcp'], createMcpRouter(discoveryEngine));

  // Lo que cuelga de un prefijo de API y no coincide con ninguna ruta nunca llega al frontend.
  app.use(['/api', '/mcp'], (req, res) => {
    res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.` });
  });

  app.use(['/api', '/mcp'], (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Error]', err);
    res.status(500).json({ error: err instanceof Error && err.message ? err.message : 'Error interno en API' });
  });

  if (process.env.NODE_ENV !== 'production') {
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
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  // Solo loopback por defecto: sin autenticación, exponerlo a la red local daría control de la PC. HOST=0.0.0.0 lo abre.
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '127.0.0.1';
  // Datos de esta PC (carpetas del usuario): se consultan ahora y no en la primera tarea; la primera tarea espera la misma promesa.
  void getUserEnvironment();

  app.listen(PORT, HOST, () => {
    console.log(`JARVIS Core authoritative full-stack host running on http://${HOST}:${PORT}`);
  });

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