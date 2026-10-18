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

import { MCPTool } from "../types.ts";
import { IMCPServer, MCPPrompt, MCPResourceTemplate } from "./types.ts";

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
      cleanedSchemas: Map<string, Record<string, unknown>>;
      hash: string;
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
      const hash = this.computeToolsHash(tools);
      let cleanedSchemas = cached?.hash === hash ? cached.cleanedSchemas : new Map<string, Record<string, unknown>>();
      if (cleanedSchemas.size === 0 || cached?.hash !== hash) {
        cleanedSchemas = new Map();
        for (const t of tools) {
          cleanedSchemas.set(t.name, cleanInputSchema(t.inputSchema || {}));
        }
      }
      this.toolsCache.set(serverName, { tools, cleanedSchemas, hash, lastFetched: now });
      this.unavailableServers.delete(serverName);
      return tools;
    } catch (err: any) {
      this.unavailableServers.set(serverName, { reason: err?.message || String(err), since: Date.now() });
      console.error(`[Discovery] ${serverName} error=${err?.message || err}`);
      return cached ? cached.tools : [];
    }
  }

  /**
   * Returns the cached cleaned schema for a tool (§10.3), recalculating only on hash change.
   */
  getCleanedSchema(serverOrAlias: string, toolName: string): Record<string, unknown> | null {
    const serverName = this.normalizeServerName(serverOrAlias);
    if (!serverName) return null;
    const cached = this.toolsCache.get(serverName);
    if (!cached) return null;
    return cached.cleanedSchemas.get(toolName) || null;
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

  private computeToolsHash(tools: MCPTool[]): string {
    const data = tools
      .map((t) => `${t.name}:${JSON.stringify(t.inputSchema || {})}`)
      .sort()
      .join("|");
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = (hash << 5) - hash + data.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(16);
  }
}