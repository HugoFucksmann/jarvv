/**
 * JARVIS Core — Servidor Node.js y host del runtime.
 * - El navegador (React) usa HTTP en /api/jarvis/*.
 * - Herramientas externas e inspectores usan los endpoints MCP en /mcp/* o /api/mcp/*.
 * - JarvisCore corre solo en el backend Node.js.
 * - SIGINT/SIGTERM cierran los servidores MCP y sus procesos hijos.
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
import { Decision20Engine } from './src/core/decision.ts';
import { QwenEngine } from './src/core/reasoner/qwen.ts';
import { JarvisCore } from './src/core/core.ts';
import { createJarvisRouter } from './src/server/jarvisRouter.ts';
import { createMcpRouter } from './src/server/mcpRouter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_PREFIXES = ['/api', '/mcp'];

async function main() {
  const app = express();
  app.use(express.json());

  // CORS: el agente ejecuta comandos en esta PC, así que solo se acepta como origen cruzado a localhost
  // (el frontend en otro puerto de localhost sigue funcionando).
  const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isLocal = !!origin && LOCAL_ORIGIN.test(origin);
    if (isLocal) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(!origin || isLocal ? 200 : 403);
    }
    next();
  });

  const servers: Record<string, IMCPServer> = {
    desktop_commander: new DesktopCommanderMCPServer(),
    free_search: new FreeSearchMCPServer(),
  };

  const discoveryEngine = new DiscoveryEngine(servers);
  const decisionEngine = new Decision20Engine();
  const qwenEngine = new QwenEngine();
  const jarvisCore = new JarvisCore(decisionEngine, discoveryEngine, qwenEngine);

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

    // En paralelo: un servidor colgado no consume el tiempo de cierre de los demás.
    const entries = Object.entries(servers);
    const results = await Promise.allSettled(entries.map(([, server]) => server.close?.()));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.warn(`[Host] Error cerrando servidor '${entries[i][0]}':`, result.reason);
      }
    });

    console.log('[Host] Todos los subprocesos MCP han finalizado limpiamente.');
    process.exit(0);
  };

  process.on('SIGINT', () => cleanShutdown('SIGINT'));
  process.on('SIGTERM', () => cleanShutdown('SIGTERM'));

  app.use('/api/jarvis', createJarvisRouter(jarvisCore, discoveryEngine));
  app.use(['/api/mcp', '/mcp'], createMcpRouter(discoveryEngine));

  // Lo que cuelga de estos prefijos y no resolvió ningún router es un 404/500 JSON,
  // nunca el index.html del frontend: los handlers de Vite/estáticos de abajo no lo ven.
  app.use(API_PREFIXES, (req, res) => {
    res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.` });
  });

  app.use(API_PREFIXES, (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Error]', err);
    res.status(500).json({ error: (err as Error | undefined)?.message || 'Error interno en API' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      try {
        const template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
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
  app.listen(PORT, HOST, () => {
    console.log(`JARVIS Core authoritative full-stack host running on http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});