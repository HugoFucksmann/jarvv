/**
 * JARVIS Core — Discovery Engine
 * Single Source of Truth for available MCP capabilities.
 * 
 * Rules:
 * - Obtains tools dynamically via tools/list.
 * - Obtains resource templates via resources/templates/list.
 * - Obtains prompts via prompts/list.
 * - Does not rely on static catalogs.
 * - Invalidates cache upon MCP reconnection.
 * - Serves tools directly to Decision #2 for selection.
 */

import { MCPTool, StepRoute } from "../types.ts";
import { IMCPServer, MCPPrompt, MCPResourceTemplate } from "./types.ts";
import { ClientMcpServer, getApiUrl } from "./clientMcpServer.ts";

export class DiscoveryEngine {
  private servers: Map<string, IMCPServer> = new Map();
  private toolsCache: Map<string, { tools: MCPTool[]; hash: string; lastFetched: number }> = new Map();

  constructor() {
    // Register default core MCP client adapters connected to backend Node.js runtime
    this.registerServer(new ClientMcpServer("windows", "1.3.27"));
    this.registerServer(new ClientMcpServer("desktop_commander", "2.1.0"));
    this.registerServer(new ClientMcpServer("free_search", "0.13.1"));
  }

  registerServer(server: IMCPServer) {
    this.servers.set(server.name, server);
    this.toolsCache.delete(server.name);
  }

  getServer(name: string): IMCPServer | undefined {
    const serverName = this.normalizeServerName(name);
    return serverName ? this.servers.get(serverName) : this.servers.get(name);
  }

  getAllServers(): IMCPServer[] {
    return Array.from(this.servers.values());
  }

  /**
   * Refreshes and returns the discovered tools for a given MCP or route
   */
  async getDiscoveredTools(routeOrMcp: StepRoute | string, forceRefresh = false): Promise<MCPTool[]> {
    const serverName = this.normalizeServerName(routeOrMcp);
    if (!serverName) return [];

    const server = this.servers.get(serverName);
    if (!server) {
      console.warn(`No server registered for ${serverName}`);
      return [];
    }

    const cached = this.toolsCache.get(serverName);
    const now = Date.now();

    // Cache valid for 30s unless forced
    if (!forceRefresh && cached && now - cached.lastFetched < 30000) {
      return cached.tools;
    }

    try {
      const tools = await server.listTools();
      const hash = this.computeToolsHash(tools);
      this.toolsCache.set(serverName, { tools, hash, lastFetched: now });
      return tools;
    } catch (err) {
      console.error(`Discovery error fetching tools for ${serverName}:`, err);
      return cached ? cached.tools : [];
    }
  }

  /**
   * Returns a snapshot of all discovered tools across all servers
   */
  async discoverAll(): Promise<Record<string, MCPTool[]>> {
    try {
      const res = await fetch(getApiUrl("/api/mcp/discover-all"));
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.includes("application/json")) {
        const data = await res.json();
        for (const [name, tools] of Object.entries(data)) {
          if (Array.isArray(tools)) {
            const hash = this.computeToolsHash(tools as MCPTool[]);
            this.toolsCache.set(name, { tools: tools as MCPTool[], hash, lastFetched: Date.now() });
          }
        }
        return data;
      }
    } catch {}

    const result: Record<string, MCPTool[]> = {};
    for (const server of this.servers.values()) {
      result[server.name] = await this.getDiscoveredTools(server.name);
    }
    return result;
  }

  /**
   * Discovers extra capabilities (prompts & resource templates) where available
   */
  async discoverExtraCapabilities(): Promise<{
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  }> {
    try {
      const res = await fetch(getApiUrl("/api/mcp/extra-capabilities"));
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.includes("application/json")) {
        return await res.json();
      }
    } catch {}

    const prompts: Record<string, MCPPrompt[]> = {};
    const resourceTemplates: Record<string, MCPResourceTemplate[]> = {};

    for (const [name, server] of this.servers.entries()) {
      if (server.listPrompts) {
        prompts[name] = await server.listPrompts();
      }
      if (server.listResourceTemplates) {
        resourceTemplates[name] = await server.listResourceTemplates();
      }
    }

    return { prompts, resourceTemplates };
  }

  /**
   * Validates if a tool exists in the active discovery cache
   */
  async validateToolExists(routeOrMcp: string, toolName: string): Promise<boolean> {
    const tools = await this.getDiscoveredTools(routeOrMcp);
    const found = tools.some((t) => t.name === toolName);
    if (!found) {
      // Refresh once dynamically as per §41
      const refreshed = await this.getDiscoveredTools(routeOrMcp, true);
      return refreshed.some((t) => t.name === toolName);
    }
    return true;
  }

  private normalizeServerName(name: string): string | null {
    if (name === "windows") return "windows";
    if (name === "desktop_commander" || name === "desktop") return "desktop_commander";
    if (name === "free_search" || name === "search") return "free_search";
    return this.servers.has(name) ? name : null;
  }

  private computeToolsHash(tools: MCPTool[]): string {
    const names = tools.map((t) => t.name).sort().join(",");
    let hash = 0;
    for (let i = 0; i < names.length; i++) {
      hash = (hash << 5) - hash + names.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(16);
  }
}
