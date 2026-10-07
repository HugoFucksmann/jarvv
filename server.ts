/**
 * JARVIS Core — Node.js Full-Stack Server & Authoritative Runtime Host
 * 
 * Target Architecture:
 * - Browser (React) communicates with JARVIS Core via HTTP (/api/jarvis/*).
 * - JarvisCore runs exclusively in Node.js backend.
 * - Decision20Engine calls Decision 2.0 via HTTP from Node.js (no browser CORS).
 * - QwenEngine calls Ollama / Qwen via HTTP from Node.js.
 * - DiscoveryEngine coordinates MCP servers via persistent stdio processes.
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
import { DiscoveryEngine } from './src/core/mcp/discovery.ts';
import { Decision20Engine } from './src/core/decision.ts';
import { QwenEngine } from './src/core/reasoner/qwen.ts';
import { JarvisCore } from './src/core/core.ts';
import { ConfigManager } from './src/core/config.ts';
import { PendingApproval } from './src/core/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const app = express();
  app.use(express.json());

  // CORS para permitir desarrollo con frontend en puerto desacoplado (e.g. Vite en :5173)
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // ============================================================
  // BACKEND RUNTIME INSTANCES (SINGLETONS)
  // ============================================================
  const windowsServer = new WindowsMCPServer();
  const desktopServer = new DesktopCommanderMCPServer();
  const freeSearchServer = new FreeSearchMCPServer();

  const servers: Record<string, IMCPServer> = {
    windows: windowsServer,
    desktop_commander: desktopServer,
    free_search: freeSearchServer,
  };

  const discoveryEngine = new DiscoveryEngine(servers);
  const decisionEngine = new Decision20Engine();
  const qwenEngine = new QwenEngine();

  // Primary authoritative JarvisCore instance in Node.js
  const jarvisCore = new JarvisCore(decisionEngine, discoveryEngine, qwenEngine);

  function getServer(name: string): IMCPServer | undefined {
    return discoveryEngine.getServer(name);
  }

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

  // ============================================================
  // 1. RUTAS /api/* (EXPRESS / BACKEND EXCLUSIVO - SIEMPRE JSON)
  // ============================================================
  const api = express.Router();

  // ------------------------------------------------------------
  // 1.1 JARVIS CORE ORCHESTRATION APIS (/api/jarvis/*)
  // ------------------------------------------------------------

  // Iniciar tarea
  api.post(['/jarvis/process', '/jarvis/task'], async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
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
  api.post('/jarvis/cancel', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
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

  // Confirmar plan (modo PLAN)
  api.post('/jarvis/confirm-plan', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const { taskId } = req.body;
    if (taskId) {
      jarvisCore.confirmPlan(taskId);
    } else {
      const allTasks = jarvisCore.getAllTasks();
      const latest = allTasks[allTasks.length - 1];
      if (latest) jarvisCore.confirmPlan(latest.id);
    }
    res.json({ ok: true });
  });

  // Aprobar operación con compuerta de seguridad Guard
  api.post('/jarvis/approve', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
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
  api.post('/jarvis/deny', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
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
  api.get('/jarvis/state', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const taskId = req.query.taskId as string | undefined;
      const allTasks = jarvisCore.getAllTasks();
      const task = taskId ? jarvisCore.getTask(taskId) : allTasks[allTasks.length - 1] || null;
      const pending = jarvisCore.getPendingApproval(task?.id);
      const tools = await discoveryEngine.discoverAll().catch(() => ({}));
      const extra = await discoveryEngine.discoverExtraCapabilities().catch(() => ({
        prompts: {},
        resourceTemplates: {},
      }));

      res.json({
        task,
        pendingApproval: serializePendingApproval(pending),
        allTasks,
        discoveredTools: tools,
        extraCapabilities: extra,
        unavailableServers: discoveryEngine.getUnavailableServers(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stream Server-Sent Events (SSE) para eventos de Core en tiempo real
  api.get('/jarvis/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const unsubscribe = jarvisCore.addEventListener((event) => {
      const currentTask = jarvisCore.getTask(event.taskId);
      const pending = jarvisCore.getPendingApproval(event.taskId);
      const payload = JSON.stringify({
        event,
        task: currentTask,
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

  // Refrescar catálogo de Discovery dinámicamente (forceRefresh=true limpia servidores marcados como no disponibles)
  api.all(['/jarvis/refresh-discovery', '/jarvis/discovery'], async (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const tools = await discoveryEngine.discoverAll(true);
      const extra = await discoveryEngine.discoverExtraCapabilities();
      res.json({ tools, extraCapabilities: extra, unavailableServers: discoveryEngine.getUnavailableServers() });
    } catch (err: any) {
      res.json({ tools: {}, extraCapabilities: { prompts: {}, resourceTemplates: {} }, error: err.message });
    }
  });

  // Configuración de endpoints externos
  api.get('/jarvis/config', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(ConfigManager.getConfig());
  });

  api.post('/jarvis/config', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const updated = ConfigManager.updateConfig(req.body);
    res.json(updated);
  });

  // ------------------------------------------------------------
  // 1.2 RUTAS DIRECTAS DE MCP (/api/mcp/*)
  // ------------------------------------------------------------

  // Descubrimiento de todas las herramientas
  api.get('/mcp/discover-all', async (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const tools = await discoveryEngine.discoverAll();
      res.json(tools);
    } catch (err: any) {
      res.json({ windows: [], desktop_commander: [], free_search: [], error: err.message });
    }
  });

  // Capacidades extra (prompts y resource templates)
  api.get('/mcp/extra-capabilities', async (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const extra = await discoveryEngine.discoverExtraCapabilities();
      res.json(extra);
    } catch {
      res.json({ prompts: {}, resourceTemplates: {} });
    }
  });

  // Listar herramientas de un servidor específico
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
      res.json({ error: err.message, tools: [] });
    }
  });

  // Ejecución de herramientas por stdio
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

  // Prompts
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

  // Plantillas de recursos
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

  // Lectura de recurso
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

  // Reconexión de proceso stdio
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

  // Estado de conexión
  api.get('/mcp/:server/status', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const server = getServer(req.params.server);
    res.json({ connected: server ? server.isConnected() : false });
  });

  // Montar router API en /api y alias /mcp
  app.use('/api', api);
  app.use('/mcp', api);

  // Barrera estricta 404: ninguna ruta de API puede continuar a Vite o servir HTML
  app.use(['/api', '/mcp'], (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.`, tools: [] });
  });

  // Barrera estricta de errores: cualquier excepción en /api o /mcp devuelve siempre JSON y jamás HTML
  app.use(['/api', '/mcp'], (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Error]', err);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ error: err?.message || 'Error interno en API', tools: [] });
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

    // Bypass estricto: Vite middleware nunca toca peticiones /api o /mcp
    app.use((req, res, next) => {
      if (
        req.originalUrl.startsWith('/api') ||
        req.originalUrl.startsWith('/mcp') ||
        req.path.startsWith('/api') ||
        req.path.startsWith('/mcp')
      ) {
        return next();
      }
      vite.middlewares(req, res, next);
    });

    // ============================================================
    // 3. FALLBACK DEL FRONTEND (INDEX.HTML DE VITE - NUNCA PARA /api o /mcp)
    // ============================================================
    app.use('*', async (req, res, next) => {
      if (
        req.originalUrl.startsWith('/api') ||
        req.originalUrl.startsWith('/mcp') ||
        req.path.startsWith('/api') ||
        req.path.startsWith('/mcp')
      ) {
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
      if (
        req.originalUrl.startsWith('/api') ||
        req.originalUrl.startsWith('/mcp') ||
        req.path.startsWith('/api') ||
        req.path.startsWith('/mcp')
      ) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.` });
      }
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JARVIS Core authoritative full-stack host running on:`);
    console.log(`  - Local:    http://localhost:${PORT}`);
    console.log(`  - Loopback: http://127.0.0.1:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
