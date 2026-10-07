/**
 * JARVIS Core — Node.js Full-Stack Server & MCP Runtime Host
 * 
 * Strict Routing Order:
 * 1. Express /api/* routes (JSON-only, never falls through to HTML)
 * 2. Vite middlewares (appType: 'custom' for assets, HMR, and scripts)
 * 3. Frontend SPA fallback (index.html, strictly non-API routes)
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WindowsMCPServer } from './src/core/mcp/windowsMcp.ts';
import { DesktopCommanderMCPServer } from './src/core/mcp/desktopCommanderMcp.ts';
import { FreeSearchMCPServer } from './src/core/mcp/freeSearchMcp.ts';
import { IMCPServer } from './src/core/mcp/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const app = express();
  app.use(express.json());

  // Persistent singleton instances of the 3 MCP servers in Node.js backend
  const servers: Record<string, IMCPServer> = {
    windows: new WindowsMCPServer(),
    desktop_commander: new DesktopCommanderMCPServer(),
    free_search: new FreeSearchMCPServer(),
  };

  function getServer(name: string): IMCPServer | undefined {
    if (name === 'windows') return servers.windows;
    if (name === 'desktop_commander' || name === 'desktop') return servers.desktop_commander;
    if (name === 'free_search' || name === 'search') return servers.free_search;
    return undefined;
  }

  // ============================================================
  // 1. RUTAS /api/* (EXPRESS / BACKEND EXCLUSIVO - SIEMPRE JSON)
  // ============================================================
  const api = express.Router();

  // 1.1 Descubrimiento de todas las herramientas
  api.get('/mcp/discover-all', async (req, res) => {
    try {
      const [winResult, deskResult, searchResult] = await Promise.allSettled([
        servers.windows.listTools(),
        servers.desktop_commander.listTools(),
        servers.free_search.listTools(),
      ]);

      res.setHeader('Content-Type', 'application/json');
      res.json({
        windows: winResult.status === 'fulfilled' ? winResult.value : [],
        desktop_commander: deskResult.status === 'fulfilled' ? deskResult.value : [],
        free_search: searchResult.status === 'fulfilled' ? searchResult.value : [],
      });
    } catch (err: any) {
      res.setHeader('Content-Type', 'application/json');
      res.json({ windows: [], desktop_commander: [], free_search: [], error: err.message });
    }
  });

  // 1.2 Capacidades extra (prompts y resource templates)
  api.get('/mcp/extra-capabilities', async (req, res) => {
    const prompts: Record<string, any[]> = {};
    const resourceTemplates: Record<string, any[]> = {};

    if (servers.free_search.listPrompts) {
      prompts.free_search = await servers.free_search.listPrompts().catch(() => []);
    }
    if (servers.free_search.listResourceTemplates) {
      resourceTemplates.free_search = await servers.free_search.listResourceTemplates().catch(() => []);
    }

    res.setHeader('Content-Type', 'application/json');
    res.json({ prompts, resourceTemplates });
  });

  // 1.3 Listar herramientas de un servidor específico
  api.get('/mcp/:server/tools', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const server = getServer(req.params.server);
    if (!server) {
      return res.status(404).json({ error: `Servidor MCP '${req.params.server}' no encontrado.`, tools: [] });
    }
    try {
      const tools = await server.listTools();
      res.json({ tools });
    } catch (err: any) {
      // Devolver JSON válido con lista vacía y descripción de error para no quebrar el frontend
      res.json({ error: err.message, tools: [] });
    }
  });

  // 1.4 Ejecución de herramientas por stdio
  api.post('/mcp/:server/call', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const server = getServer(req.params.server);
    if (!server) {
      return res.status(404).json({
        isError: true,
        success: false,
        content: [{ type: 'text', text: `Servidor MCP '${req.params.server}' no encontrado.` }],
      });
    }
    const { name, args } = req.body;
    if (!name) {
      return res.status(400).json({
        isError: true,
        success: false,
        content: [{ type: 'text', text: 'Falta el nombre de la herramienta.' }],
      });
    }
    try {
      const result = await server.callTool(name, args || {});
      res.json(result);
    } catch (err: any) {
      res.json({
        isError: true,
        success: false,
        content: [{ type: 'text', text: `[MCP Server Error] ${err.message}` }],
      });
    }
  });

  // 1.5 Prompts
  api.get('/mcp/:server/prompts', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const server = getServer(req.params.server);
    if (!server || !server.listPrompts) {
      return res.json({ prompts: [] });
    }
    try {
      const prompts = await server.listPrompts();
      res.json({ prompts });
    } catch {
      res.json({ prompts: [] });
    }
  });

  // 1.6 Plantillas de recursos
  api.get('/mcp/:server/resource-templates', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const server = getServer(req.params.server);
    if (!server || !server.listResourceTemplates) {
      return res.json({ resourceTemplates: [] });
    }
    try {
      const resourceTemplates = await server.listResourceTemplates();
      res.json({ resourceTemplates });
    } catch {
      res.json({ resourceTemplates: [] });
    }
  });

  // 1.7 Lectura de recurso
  api.post('/mcp/:server/resources', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const server = getServer(req.params.server);
    if (!server || !server.readResource) {
      return res.status(404).json({ error: 'readResource no soportado', text: '' });
    }
    try {
      const text = await server.readResource(req.body.uri);
      res.json({ text });
    } catch (err: any) {
      res.json({ error: err.message, text: '' });
    }
  });

  // 1.8 Reconexión de proceso stdio
  api.post('/mcp/:server/reconnect', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const server = getServer(req.params.server);
    if (!server) {
      return res.status(404).json({ error: `Servidor MCP '${req.params.server}' no encontrado.`, ok: false });
    }
    try {
      await server.reconnect();
      res.json({ ok: true });
    } catch (err: any) {
      res.json({ error: err.message, ok: false });
    }
  });

  // 1.9 Estado de conexión
  api.get('/mcp/:server/status', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const server = getServer(req.params.server);
    res.json({ connected: server ? server.isConnected() : false });
  });

  // Montar router API
  app.use('/api', api);

  // Barrera estricta 404: ninguna ruta /api no encontrada puede continuar
  app.use('/api', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.`, tools: [] });
  });

  // Barrera estricta de errores: cualquier excepción en /api devuelve siempre JSON y jamás HTML
  app.use('/api', (err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API MCP Error]', err);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ error: err?.message || 'Error interno en API MCP', tools: [] });
  });

  // ============================================================
  // 2. MIDDLEWARE DE VITE (DESARROLLO) / ESTÁTICOS (PRODUCCIÓN)
  // ============================================================
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);

    // ============================================================
    // 3. FALLBACK DEL FRONTEND (INDEX.HTML DE VITE - NUNCA PARA /api)
    // ============================================================
    app.use('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api') || req.path.startsWith('/api')) {
        res.setHeader('Content-Type', 'application/json');
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
      if (req.originalUrl.startsWith('/api') || req.path.startsWith('/api')) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.` });
      }
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JARVIS Core full-stack host running on http://0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
