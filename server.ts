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

  // Acceso solo local: el agente ejecuta comandos en esta PC. Se exige un Host local (frena el DNS rebinding) y,
  // si el request trae Origin, que también sea local, sea cual sea el método (el frontend en otro puerto de
  // localhost sigue funcionando). Los requests sin Origin (mismo origen, curl) pasan.
  const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
  const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
  app.use((req, res, next) => {
    if (!LOCAL_HOST.test(req.headers.host ?? '')) {
      return res.status(403).json({ error: 'Host no permitido.' });
    }
    const origin = req.headers.origin;
    if (origin) {
      if (!LOCAL_ORIGIN.test(origin)) {
        return res.status(403).json({ error: 'Origen no permitido.' });
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Instancias del runtime (singletons)
  const desktopServer = new DesktopCommanderMCPServer();
  const freeSearchServer = new FreeSearchMCPServer();

  const servers: Record<string, IMCPServer> = {
    desktop_commander: desktopServer,
    free_search: freeSearchServer,
  };

  const discoveryEngine = new DiscoveryEngine(servers);
  const decisionEngine = new Decision20Engine();
  const llm = new QwenEngine();

  const jarvisCore = new JarvisCore({ decisionEngine, discoveryEngine, llm });

  // Cierre ordenado de procesos
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

  // 1. Rutas de la API
  app.use('/api/jarvis', createJarvisRouter(jarvisCore, discoveryEngine));
  app.use(['/api/mcp', '/mcp'], createMcpRouter(discoveryEngine));

  // Lo que cuelga de un prefijo de API y no coincide con ninguna ruta nunca llega al frontend.
  app.use(['/api', '/mcp'], (req, res) => {
    res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.` });
  });

  app.use(['/api', '/mcp'], (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Error]', err);
    res.status(500).json({ error: err instanceof Error && err.message ? err.message : 'Error interno en API' });
  });

  // 2. Frontend: Vite en desarrollo, archivos estáticos en producción
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
  app.listen(PORT, HOST, () => {
    console.log(`JARVIS Core authoritative full-stack host running on http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});