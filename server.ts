/**
 * JARVIS Core — Node.js Full-Stack Server & MCP Runtime Host
 * 
 * Responsibilities:
 * - Runs exclusively in Node.js runtime.
 * - Hosts persistent StdioMcpTransport instances for Windows, Desktop Commander, and Free Search.
 * - Preserves persistent OS processes and session states across API calls.
 * - Exposes local JSON API for the React frontend (/api/mcp/*).
 * - Mounts Vite middleware on port 3000 during development.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WindowsMCPServer } from './src/core/mcp/windowsMcp.ts';
import { DesktopCommanderMCPServer } from './src/core/mcp/desktopCommanderMcp.ts';
import { FreeSearchMCPServer } from './src/core/mcp/freeSearchMcp.ts';
import { IMCPServer } from './src/core/mcp/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// 1. Discover all tools across all 3 MCP servers
app.get('/api/mcp/discover-all', async (req, res) => {
  try {
    const [winResult, deskResult, searchResult] = await Promise.allSettled([
      servers.windows.listTools(),
      servers.desktop_commander.listTools(),
      servers.free_search.listTools(),
    ]);

    res.json({
      windows: winResult.status === 'fulfilled' ? winResult.value : [],
      desktop_commander: deskResult.status === 'fulfilled' ? deskResult.value : [],
      free_search: searchResult.status === 'fulfilled' ? searchResult.value : [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Extra capabilities (prompts & resource templates)
app.get('/api/mcp/extra-capabilities', async (req, res) => {
  try {
    const prompts: Record<string, any[]> = {};
    const resourceTemplates: Record<string, any[]> = {};

    if (servers.free_search.listPrompts) {
      prompts.free_search = await servers.free_search.listPrompts().catch(() => []);
    }
    if (servers.free_search.listResourceTemplates) {
      resourceTemplates.free_search = await servers.free_search.listResourceTemplates().catch(() => []);
    }

    res.json({ prompts, resourceTemplates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. List tools for a specific server
app.get('/api/mcp/:server/tools', async (req, res) => {
  const server = getServer(req.params.server);
  if (!server) {
    return res.status(404).json({ error: `Servidor MCP '${req.params.server}' no encontrado.` });
  }
  try {
    const tools = await server.listTools();
    res.json({ tools });
  } catch (err: any) {
    res.status(500).json({ error: err.message, tools: [] });
  }
});

// 4. Call a tool on a specific server (persistent stdin/stdout stream)
app.post('/api/mcp/:server/call', async (req, res) => {
  const server = getServer(req.params.server);
  if (!server) {
    return res.status(404).json({ error: `Servidor MCP '${req.params.server}' no encontrado.` });
  }
  const { name, args } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Falta el nombre de la herramienta.' });
  }
  try {
    const result = await server.callTool(name, args || {});
    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      isError: true,
      success: false,
      content: [{ type: 'text', text: `[MCP Server Error] ${err.message}` }],
    });
  }
});

// 5. Prompts
app.get('/api/mcp/:server/prompts', async (req, res) => {
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

// 6. Resource templates
app.get('/api/mcp/:server/resource-templates', async (req, res) => {
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

// 7. Read resource
app.post('/api/mcp/:server/resources', async (req, res) => {
  const server = getServer(req.params.server);
  if (!server || !(server as any).readResource) {
    return res.status(404).json({ error: 'readResource no soportado' });
  }
  try {
    const text = await (server as any).readResource(req.body.uri);
    res.json({ text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Reconnect
app.post('/api/mcp/:server/reconnect', async (req, res) => {
  const server = getServer(req.params.server);
  if (!server) {
    return res.status(404).json({ error: `Servidor MCP '${req.params.server}' no encontrado.` });
  }
  try {
    await server.reconnect();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Status
app.get('/api/mcp/:server/status', (req, res) => {
  const server = getServer(req.params.server);
  res.json({ connected: server ? server.isConnected() : false });
});

// Mount Vite middleware in dev or serve static bundle in production
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JARVIS Core full-stack host running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
