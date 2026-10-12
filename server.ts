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
import { RefStore } from './src/core/processor/resultProcessor.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const app = express();
  app.use(express.json());

  // CORS para permitir desarrollo con frontend en puerto desacoplado
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
  // CIERRE ORDENADO DE PROCESOS (CLEAN SHUTDOWN HOOKS)
  // ============================================================
  let isShuttingDown = false;
  const cleanShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Host] Señal ${signal} recibida. Finalizando servidores MCP y procesos hijos...`);

    for (const [name, server] of Object.entries(servers)) {
      try {
        if ('close' in server && typeof (server as any).close === 'function') {
          await (server as any).close();
        } else if ((server as any).transport && typeof (server as any).transport.close === 'function') {
          await (server as any).transport.close();
        }
      } catch (err) {
        console.warn(`[Host] Error cerrando transporte para '${name}':`, err);
      }
    }

    console.log('[Host] Todos los subprocesos MCP han finalizado limpiamente.');
    process.exit(0);
  };

  process.on('SIGINT', () => cleanShutdown('SIGINT'));
  process.on('SIGTERM', () => cleanShutdown('SIGTERM'));

  // ============================================================
  // 1. SUB-ROUTERS API
  // ============================================================

  // ------------------------------------------------------------
  // 1.1 JARVIS CORE ORCHESTRATION ROUTER
  // ------------------------------------------------------------
  const jarvisRouter = express.Router();

  // Iniciar tarea
  jarvisRouter.post(['/process', '/task'], async (req, res) => {
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
  jarvisRouter.post('/cancel', (req, res) => {
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
  jarvisRouter.post('/confirm-plan', (req, res) => {
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
  jarvisRouter.post('/approve', (req, res) => {
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
  jarvisRouter.post('/deny', (req, res) => {
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
  jarvisRouter.get('/state', async (req, res) => {
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
  jarvisRouter.get('/events', (req, res) => {
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

  // Refrescar catálogo de Discovery dinámicamente
  jarvisRouter.all(['/refresh-discovery', '/discovery'], async (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const tools = await discoveryEngine.discoverAll(true);
      const extra = await discoveryEngine.discoverExtraCapabilities();
      res.json({ tools, extraCapabilities: extra, unavailableServers: discoveryEngine.getUnavailableServers() });
    } catch (err: any) {
      res.json({ tools: {}, extraCapabilities: { prompts: {}, resourceTemplates: {} }, error: err.message });
    }
  });

  // Recuperar contenido de una referencia en RefStore (Hallazgo #10)
  jarvisRouter.get('/ref/:refKey', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const { refKey } = req.params;
    const taskId = req.query.taskId as string | undefined;
    const content = RefStore.get(refKey, taskId);
    if (content !== undefined) {
      res.json({ refKey, content, found: true });
    } else {
      res.status(404).json({ error: `Referencia '${refKey}' no encontrada.`, found: false });
    }
  });

  // Configuración de endpoints externos
  jarvisRouter.get('/config', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(ConfigManager.getConfig());
  });

  jarvisRouter.post('/config', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const updated = ConfigManager.updateConfig(req.body);
    res.json(updated);
  });

  // ------------------------------------------------------------
  // 1.2 MCP DIRECT ENDPOINTS ROUTER
  // ------------------------------------------------------------
  const mcpRouter = express.Router();

  // Descubrimiento de todas las herramientas
  mcpRouter.get('/discover-all', async (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const tools = await discoveryEngine.discoverAll();
      res.json(tools);
    } catch (err: any) {
      res.json({ windows: [], desktop_commander: [], free_search: [], error: err.message });
    }
  });

  // Capacidades extra (prompts y resource templates)
  mcpRouter.get('/extra-capabilities', async (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const extra = await discoveryEngine.discoverExtraCapabilities();
      res.json(extra);
    } catch {
      res.json({ prompts: {}, resourceTemplates: {} });
    }
  });

  // Listar herramientas de un servidor específico
  mcpRouter.get('/:server/tools', async (req, res) => {
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
  mcpRouter.post('/:server/call', async (req, res) => {
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
  mcpRouter.get('/:server/prompts', async (req, res) => {
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
  mcpRouter.get('/:server/resource-templates', async (req, res) => {
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
  mcpRouter.post('/:server/resources', async (req, res) => {
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
  mcpRouter.post('/:server/reconnect', async (req, res) => {
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
  mcpRouter.get('/:server/status', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const server = getServer(req.params.server);
    res.json({ connected: server ? server.isConnected() : false });
  });

  // ============================================================
  // MONTAJE UNIFICADO DE RUTAS
  // ============================================================
  app.use('/api/jarvis', jarvisRouter);
  app.use('/jarvis', jarvisRouter);
  app.use('/api/mcp', mcpRouter);
  app.use('/mcp', mcpRouter);

  // Barrera estricta 404 para prefijos de API
  app.use(['/api', '/mcp', '/jarvis'], (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(404).json({ error: `Ruta API '${req.originalUrl}' no encontrada.` });
  });

  // Barrera estricta de errores para prefijos de API
  app.use(['/api', '/mcp', '/jarvis'], (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Error]', err);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ error: err?.message || 'Error interno en API' });
  });

  // ============================================================
  // 2. MIDDLEWARE DE VITE (DESARROLLO) / ESTÁTICOS (PRODUCCIÓN)
  // ============================================================
  const isApiRequest = (url: string, pathName: string) =>
    url.startsWith('/api') ||
    url.startsWith('/mcp') ||
    url.startsWith('/jarvis') ||
    pathName.startsWith('/api') ||
    pathName.startsWith('/mcp') ||
    pathName.startsWith('/jarvis');

  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    app.use((req, res, next) => {
      if (isApiRequest(req.originalUrl, req.path)) {
        return next();
      }
      vite.middlewares(req, res, next);
    });

    // ============================================================
    // 3. FALLBACK DEL FRONTEND (INDEX.HTML DE VITE)
    // ============================================================
    app.use('*', async (req, res, next) => {
      if (isApiRequest(req.originalUrl, req.path)) {
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
      if (isApiRequest(req.originalUrl, req.path)) {
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