/**
 * JARVIS Core — Node.js Full-Stack Server & Authoritative Runtime Host
 * 
 * Target Architecture:
 * - Browser (React) communicates with JARVIS Core via HTTP (/api/jarvis/*).
 * - Direct external tools/inspectors communicate with MCP endpoints (/mcp/* or /api/mcp/*).
 * - JarvisCore runs exclusively in Node.js backend.
 * - Clean shutdown handling for SIGINT/SIGTERM to terminate child process trees.
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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


  // BACKEND RUNTIME INSTANCES (SINGLETONS)

  const desktopServer = new DesktopCommanderMCPServer();
  const freeSearchServer = new FreeSearchMCPServer();

  const servers: Record<string, IMCPServer> = {
    desktop_commander: desktopServer,
    free_search: freeSearchServer,
  };

  const discoveryEngine = new DiscoveryEngine(servers);
  const decisionEngine = new Decision20Engine();
  const qwenEngine = new QwenEngine();

  // Primary authoritative JarvisCore instance in Node.js
  const jarvisCore = new JarvisCore(decisionEngine, discoveryEngine, qwenEngine);


  // CIERRE ORDENADO DE PROCESOS (CLEAN SHUTDOWN HOOKS)

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

    for (const [name, server] of Object.entries(servers)) {
      try {
        if (typeof server.close === 'function') {
          await server.close();
        }
      } catch (err) {
        console.warn(`[Host] Error cerrando servidor '${name}':`, err);
      }
    }

    console.log('[Host] Todos los subprocesos MCP han finalizado limpiamente.');
    process.exit(0);
  };

  process.on('SIGINT', () => cleanShutdown('SIGINT'));
  process.on('SIGTERM', () => cleanShutdown('SIGTERM'));


  // 1. MONTAJE DE RUTAS MODULARES

  const jarvisRouter = createJarvisRouter(jarvisCore, discoveryEngine);
  const mcpRouter = createMcpRouter(discoveryEngine);

  app.use('/api/jarvis', jarvisRouter);
  app.use('/jarvis', jarvisRouter);
  app.use('/api/mcp', mcpRouter);
  app.use('/mcp', mcpRouter);

  // Barrera estricta 404 para prefijos de API
  app.use(['/api', '/mcp', '/jarvis'], (req, res) => {
    res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.` });
  });

  // Barrera estricta de errores para prefijos de API
  app.use(['/api', '/mcp', '/jarvis'], (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Error]', err);
    res.status(500).json({ error: err?.message || 'Error interno en API' });
  });


  // 2. MIDDLEWARE DE VITE (DESARROLLO) / ESTÁTICOS (PRODUCCIÓN)

  // Por segmento de ruta (no por prefijo de texto) y sobre originalUrl: dentro de app.use('*') req.path no es fiable.
  const API_PREFIXES = ['/api', '/mcp', '/jarvis'];
  const isApiRequest = (url: string) => {
    const pathName = url.split('?')[0];
    return API_PREFIXES.some((prefix) => pathName === prefix || pathName.startsWith(`${prefix}/`));
  };

  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    app.use((req, res, next) => {
      if (isApiRequest(req.originalUrl)) {
        return next();
      }
      vite.middlewares(req, res, next);
    });


    // 3. FALLBACK DEL FRONTEND (INDEX.HTML DE VITE)

    app.use('*', async (req, res, next) => {
      if (isApiRequest(req.originalUrl)) {
        return res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.` });
      }
      try {
        const template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      if (isApiRequest(req.originalUrl)) {
        return res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.` });
      }
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