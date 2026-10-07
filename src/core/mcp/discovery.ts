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
import { WindowsMCPServer } from "./windowsMcp.ts";
import { DesktopCommanderMCPServer } from "./desktopCommanderMcp.ts";
import { FreeSearchMCPServer } from "./freeSearchMcp.ts";

export class DiscoveryEngine {
  private servers: Map<string, IMCPServer> = new Map();
  private toolsCache: Map<string, { tools: MCPTool[]; hash: string; lastFetched: number }> = new Map();
  /** Servers that failed to start and should not be retried automatically. */
  private unavailableServers: Map<string, { reason: string; since: number }> = new Map();

  constructor(customServers?: Record<string, IMCPServer>) {
    if (customServers) {
      for (const server of Object.values(customServers)) {
        this.registerServer(server);
      }
    } else {
      this.registerServer(new WindowsMCPServer());
      this.registerServer(new DesktopCommanderMCPServer());
      this.registerServer(new FreeSearchMCPServer());
    }
  }

  registerServer(server: IMCPServer) {
    this.servers.set(server.name, server);
    this.toolsCache.delete(server.name);
    // Clear unavailable status when a server is re-registered
    this.unavailableServers.delete(server.name);
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

    // If server has a known permanent failure and we are not forcing a refresh, return cached/empty immediately
    if (!forceRefresh && this.unavailableServers.has(serverName)) {
      const cached = this.toolsCache.get(serverName);
      return cached ? cached.tools : [];
    }

    const cached = this.toolsCache.get(serverName);
    const now = Date.now();

    // Cache valid for 30s unless forced
    if (!forceRefresh && cached && now - cached.lastFetched < 30000) {
      return cached.tools;
    }

    // If forcing refresh, clear the unavailable mark so we give the server another chance
    if (forceRefresh) {
      this.unavailableServers.delete(serverName);
    }

    try {
      const tools = await server.listTools();
      const hash = this.computeToolsHash(tools);
      this.toolsCache.set(serverName, { tools, hash, lastFetched: now });
      // Server responded successfully — ensure it's no longer marked unavailable
      this.unavailableServers.delete(serverName);
      return tools;
    } catch (err: any) {
      // Mark as unavailable so we don't keep hammering a dead process
      this.unavailableServers.set(serverName, { reason: err?.message || String(err), since: Date.now() });
      console.error(`[Discovery] MCP '${serverName}' marcado como no disponible: ${err?.message}`);
      return cached ? cached.tools : [];
    }
  }

  /**
   * Returns a snapshot of all discovered tools across all servers.
   * forceRefresh=true clears unavailable marks and retries all servers.
   */
  async discoverAll(forceRefresh = false): Promise<Record<string, MCPTool[]>> {
    const result: Record<string, MCPTool[]> = {};
    for (const server of this.servers.values()) {
      result[server.name] = await this.getDiscoveredTools(server.name, forceRefresh);
    }
    return result;
  }

  /** Returns which servers are currently marked as unavailable and why. */
  getUnavailableServers(): Record<string, { reason: string; since: number }> {
    const out: Record<string, { reason: string; since: number }> = {};
    for (const [name, info] of this.unavailableServers.entries()) {
      out[name] = info;
    }
    return out;
  }

  /**
   * Discovers extra capabilities (prompts & resource templates) where available
   */
  async discoverExtraCapabilities(): Promise<{
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  }> {
    const prompts: Record<string, MCPPrompt[]> = {};
    const resourceTemplates: Record<string, MCPResourceTemplate[]> = {};

    for (const [name, server] of this.servers.entries()) {
      if (server.listPrompts) {
        try {
          prompts[name] = await server.listPrompts();
        } catch {
          prompts[name] = [];
        }
      }
      if (server.listResourceTemplates) {
        try {
          resourceTemplates[name] = await server.listResourceTemplates();
        } catch {
          resourceTemplates[name] = [];
        }
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
