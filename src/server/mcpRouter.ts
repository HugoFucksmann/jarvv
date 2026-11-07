import express from 'express';
import { DiscoveryEngine } from '../core/mcp/discovery.ts';
import { IMCPServer } from '../core/mcp/types.ts';
import { Guard } from '../core/policy/guard.ts';
import { getToolPolicy } from '../core/tools/manifest.ts';
import { errorMessage } from '../core/utils.ts';

export function createMcpRouter(discoveryEngine: DiscoveryEngine): express.Router {
  const router = express.Router();

  function getServer(name: string): IMCPServer | undefined {
    return discoveryEngine.getServer(name);
  }

  // Descubrimiento de todas las herramientas
  router.get('/discover-all', async (_req, res) => {
    try {
      const tools = await discoveryEngine.discoverAll();
      res.json(tools);
    } catch (err) {
      res.json({ desktop_commander: [], free_search: [], error: errorMessage(err) });
    }
  });



  // Listar herramientas de un servidor específico
  router.get('/:server/tools', async (req, res) => {
    const server = getServer(req.params.server);
    if (!server) {
      return res.status(404).json({ error: `Servidor MCP '${req.params.server}' no encontrado.`, tools: [] });
    }
    try {
      const tools = await server.listTools();
      res.json({ tools });
    } catch (err) {
      res.json({ error: errorMessage(err), tools: [] });
    }
  });

  // Ejecución de herramientas por stdio
  router.post('/:server/call', async (req, res) => {
    const server = getServer(req.params.server);
    if (!server) {
      return res.status(404).json({
        isError: true,
        success: false,
        content: [{ type: 'text', text: `Servidor MCP '${req.params.server}' no encontrado.` }],
      });
    }
    const { name, args } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        isError: true,
        success: false,
        content: [{ type: 'text', text: 'Falta el nombre de la herramienta.' }],
      });
    }
    const toolArgs: Record<string, unknown> = args && typeof args === 'object' && !Array.isArray(args) ? args : {};

    const policy = getToolPolicy(req.params.server, name);
    const verdict = Guard.evaluate(req.params.server, name, toolArgs);
    if (policy.mutates || verdict.decision !== 'ALLOW') {
      console.warn(`[MCP /call] Rechazada '${req.params.server}/${name}' (mutates=${policy.mutates}, guard=${verdict.decision}).`);
      return res.status(403).json({
        isError: true,
        success: false,
        content: [{
          type: 'text',
          text: `Operación no permitida desde este endpoint (${verdict.decision}${verdict.reason ? `: ${verdict.reason}` : ''}). Las acciones que modifican el entorno solo se ejecutan dentro de una tarea, con la política de seguridad y la aprobación correspondientes.`,
        }],
      });
    }
    try {
      const result = await server.callTool(name, toolArgs);
      res.json(result);
    } catch (err) {
      res.json({
        isError: true,
        success: false,
        content: [{ type: 'text', text: `[MCP Server Error] ${errorMessage(err)}` }],
      });
    }
  });


  // Reconexión de proceso stdio
  router.post('/:server/reconnect', async (req, res) => {
    const server = getServer(req.params.server);
    if (!server) {
      return res.status(404).json({ error: `Servidor MCP '${req.params.server}' no encontrado.`, ok: false });
    }
    try {
      await server.reconnect();
      res.json({ ok: true });
    } catch (err) {
      res.json({ error: errorMessage(err), ok: false });
    }
  });

  // Estado de conexión
  router.get('/:server/status', (req, res) => {
    const server = getServer(req.params.server);
    res.json({ connected: server ? server.isConnected() : false });
  });

  return router;
}