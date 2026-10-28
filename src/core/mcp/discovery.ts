/**
 * JARVIS Core — Discovery Engine
 * Fuente única de verdad de las capacidades MCP disponibles.
 *
 * Reglas:
 * - Obtiene las herramientas dinámicamente con tools/list.
 * - No depende de catálogos estáticos.
 * - Invalida la caché al reconectar un servidor MCP.
 * - Entrega las herramientas directamente a Decision #2 para que elija.
 */

import type { MCPTool } from "../types.ts";
import type { IMCPServer } from "./types.ts";
import { errorMessage } from "../utils.ts";

/** Vigencia de la caché de herramientas por servidor. */
const TOOLS_CACHE_TTL_MS = 30000;

export class DiscoveryEngine {
  private servers: Map<string, IMCPServer> = new Map();
  private toolsCache: Map<
    string,
    {
      tools: MCPTool[];
      lastFetched: number;
    }
  > = new Map();
  /** Servidores que fallaron al listar herramientas: no se reintentan solos, solo con un refresco forzado. */
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
    return this.servers.get(name);
  }

  getAllServers(): IMCPServer[] {
    return Array.from(this.servers.values());
  }

  /** Herramientas descubiertas de un servidor MCP; `forceRefresh` ignora la caché y el estado "no disponible". */
  async getDiscoveredTools(serverName: string, forceRefresh = false): Promise<MCPTool[]> {
    const server = this.servers.get(serverName);
    if (!server) return [];

    if (!forceRefresh && this.unavailableServers.has(serverName)) {
      const cached = this.toolsCache.get(serverName);
      return cached ? cached.tools : [];
    }

    const cached = this.toolsCache.get(serverName);
    const now = Date.now();

    if (!forceRefresh && cached && now - cached.lastFetched < TOOLS_CACHE_TTL_MS) {
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
    } catch (err) {
      const reason = errorMessage(err);
      this.unavailableServers.set(serverName, { reason, since: Date.now() });
      console.error(`[Discovery] ${serverName} error=${reason}`);
      return cached ? cached.tools : [];
    }
  }

  /** Instantánea de las herramientas descubiertas en todos los servidores, consultados en paralelo. */
  async discoverAll(forceRefresh = false): Promise<Record<string, MCPTool[]>> {
    const entries = await Promise.all(
      Array.from(this.servers.values(), async (server) => [server.name, await this.getDiscoveredTools(server.name, forceRefresh)] as const)
    );
    return Object.fromEntries(entries);
  }

  /** Servidores marcados hoy como no disponibles y el motivo. */
  getUnavailableServers(): Record<string, { reason: string; since: number }> {
    const out: Record<string, { reason: string; since: number }> = {};
    for (const [name, info] of this.unavailableServers.entries()) {
      out[name] = info;
    }
    return out;
  }

  /** ¿Existe la herramienta? Si no está en la caché, refresca el catálogo una vez antes de darla por inexistente. */
  async validateToolExists(serverName: string, toolName: string): Promise<boolean> {
    const tools = await this.getDiscoveredTools(serverName);
    if (tools.some((t) => t.name === toolName)) return true;
    const refreshed = await this.getDiscoveredTools(serverName, true);
    return refreshed.some((t) => t.name === toolName);
  }
}