/**
 * JARVIS Core — Discovery Engine: fuente única de las herramientas MCP disponibles.
 * Las obtiene dinámicamente con tools/list (sin catálogos estáticos) y las cachea por servidor; un servidor que
 * falla queda "no disponible" hasta un refresco forzado.
 */

import type { MCPTool } from "../types.ts";
import type { IMCPServer } from "./types.ts";
import type { TaskEndOutcome } from "../tools/provider.ts";
import { errorMessage } from "../utils.ts";

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

  async discoverAll(forceRefresh = false): Promise<Record<string, MCPTool[]>> {
    const entries = await Promise.all(
      Array.from(this.servers.values(), async (server) => [server.name, await this.getDiscoveredTools(server.name, forceRefresh)] as const)
    );
    return Object.fromEntries(entries);
  }

  /** Avisa a todos los proveedores que terminó una tarea (cierre de lo que dejó corriendo). Nunca lanza: un fallo se informa. */
  async notifyTaskEnd(taskId: string, outcome: TaskEndOutcome): Promise<void> {
    await Promise.allSettled(
      Array.from(this.servers.values(), async (server) => {
        try {
          await server.onTaskEnd?.(taskId, outcome);
        } catch (err) {
          console.warn(`[Discovery] ${server.name}.onTaskEnd falló: ${errorMessage(err)}`);
        }
      }),
    );
  }

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