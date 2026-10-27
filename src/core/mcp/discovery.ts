/**
 * JARVIS Core — Discovery Engine
 * Single Source of Truth for available MCP capabilities.
 * 
 * Rules:
 * - Obtains tools dynamically via tools/list.
 * - Does not rely on static catalogs.
 * - Invalidates cache upon MCP reconnection.
 * - Serves tools directly to Decision #2 for selection.
 */

import type { MCPTool } from "../types.ts";
import type { IMCPServer } from "./types.ts";

/**
 * Removes $schema, title, additionalProperties, and examples from inputSchema (§10.3)
 */
export function cleanInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema" || key === "title" || key === "additionalProperties" || key === "examples") {
      continue;
    }
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const cleanedProps: Record<string, unknown> = {};
      for (const [propName, propDef] of Object.entries(value as Record<string, unknown>)) {
        if (propDef && typeof propDef === "object" && !Array.isArray(propDef)) {
          cleanedProps[propName] = cleanInputSchema(propDef as Record<string, unknown>);
        } else {
          cleanedProps[propName] = propDef;
        }
      }
      cleaned[key] = cleanedProps;
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export class DiscoveryEngine {
  private servers: Map<string, IMCPServer> = new Map();
  private toolsCache: Map<
    string,
    {
      tools: MCPTool[];
      lastFetched: number;
    }
  > = new Map();
  /** Servers that failed to start and should not be retried automatically. */
  private unavailableServers: Map<string, { reason: string; since: number }> = new Map();

  constructor(customServers?: Record<string, IMCPServer> | IMCPServer[]) {
    if (customServers) {
      const serverList = Array.isArray(customServers) ? customServers : Object.values(customServers);
      for (const server of serverList) {
        this.registerServer(server);
      }
    }
  }

  registerServer(server: IMCPServer) {
    this.servers.set(server.name, server);
    this.toolsCache.delete(server.name);
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
   * Refreshes and returns the discovered tools for a given MCP server
   */
  async getDiscoveredTools(serverOrAlias: string, forceRefresh = false): Promise<MCPTool[]> {
    const serverName = this.normalizeServerName(serverOrAlias);
    if (!serverName) return [];

    const server = this.servers.get(serverName);
    if (!server) {
      console.warn(`No server registered for ${serverName}`);
      return [];
    }

    if (!forceRefresh && this.unavailableServers.has(serverName)) {
      const cached = this.toolsCache.get(serverName);
      return cached ? cached.tools : [];
    }

    const cached = this.toolsCache.get(serverName);
    const now = Date.now();

    if (!forceRefresh && cached && now - cached.lastFetched < 30000) {
      return cached.tools;
    }

    if (forceRefresh) {
      this.unavailableServers.delete(serverName);
    }

    try {
      const tools = await server.listTools();
      this.toolsCache.set(serverName, { tools, lastFetched: now });
      this.unavailableServers.delete(serverName);
      return tools;
    } catch (err: any) {
      this.unavailableServers.set(serverName, { reason: err?.message || String(err), since: Date.now() });
      console.error(`[Discovery] ${serverName} error=${err?.message || err}`);
      return cached ? cached.tools : [];
    }
  }

  /**
   * Returns a snapshot of all discovered tools across all servers.
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
   * Validates if a tool exists in the active discovery cache
   */
  async validateToolExists(serverOrAlias: string, toolName: string): Promise<boolean> {
    const tools = await this.getDiscoveredTools(serverOrAlias);
    const found = tools.some((t) => t.name === toolName);
    if (!found) {
      const refreshed = await this.getDiscoveredTools(serverOrAlias, true);
      return refreshed.some((t) => t.name === toolName);
    }
    return true;
  }

  private normalizeServerName(name: string): string | null {
    if (name === "desktop_commander" || name === "desktop" || name === "commander") return "desktop_commander";
    if (name === "free_search" || name === "search" || name === "web") return "free_search";
    return this.servers.has(name) ? name : null;
  }
}