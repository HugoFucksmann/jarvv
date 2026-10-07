/**
 * Client-Side MCP Server Adapter
 * Connects the frontend JARVIS Core to the backend Node.js MCP runtime via local API.
 * 
 * Rules:
 * - Does NOT import node:child_process or spawn.
 * - Implements IMCPServer contract so DiscoveryEngine and JarvisCore remain unchanged.
 * - Forwards discovery and tool execution to the backend persistent MCP processes.
 */

import { IMCPServer, MCPPrompt, MCPResourceTemplate } from "./types.ts";
import { MCPTool, MCPCallResult } from "../types.ts";

/**
 * Resuelve la URL base de la API backend de forma dinámica.
 * - Si VITE_API_URL está definida en .env, usa ese origen.
 * - Si se ejecuta en navegador en localhost con un puerto de frontend distinto a 3000 (e.g. Vite en 5173),
 *   apunta directamente al backend en el puerto 3000.
 * - En cualquier otro caso (mismo puerto 3000 o producción), usa URL relativa.
 */
export function getApiBaseUrl(): string {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) {
    return (import.meta.env.VITE_API_URL as string).replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location) {
    const { hostname, port, protocol } = window.location;
    if ((hostname === "localhost" || hostname === "127.0.0.1") && port && port !== "3000") {
      return `${protocol}//${hostname}:3000`;
    }
  }
  return "";
}

export function getApiUrl(endpoint: string): string {
  const base = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return base ? `${base}${cleanEndpoint}` : cleanEndpoint;
}

export class ClientMcpServer implements IMCPServer {
  constructor(
    public readonly name: string,
    public readonly version: string
  ) {}

  isConnected(): boolean {
    return true;
  }

  async reconnect(): Promise<void> {
    try {
      await fetch(getApiUrl(`/api/mcp/${this.name}/reconnect`), { method: "POST" });
    } catch (err) {
      console.warn(`[ClientMcpServer] Reconnect error for ${this.name}:`, err);
    }
  }

  async listTools(): Promise<MCPTool[]> {
    const url = getApiUrl(`/api/mcp/${this.name}/tools`);
    const res = await fetch(url);
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok) {
      throw new Error(`Error ${res.status} al obtener herramientas de '${this.name}'`);
    }
    if (!contentType.includes("application/json")) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Respuesta no JSON (${contentType || "sin content-type"}) desde '${url}'. Verifique que el backend Express esté escuchando en el puerto 3000. Inicio: ${text.slice(0, 80)}`
      );
    }
    const data = await res.json();
    return data.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const url = getApiUrl(`/api/mcp/${this.name}/call`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args }),
    });
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        isError: true,
        success: false,
        content: [{ type: "text", text: `[MCP API Error ${res.status}] ${errText}` }],
      };
    }
    if (!contentType.includes("application/json")) {
      const errText = await res.text().catch(() => "");
      return {
        isError: true,
        success: false,
        content: [{ type: "text", text: `[MCP API Error] Respuesta no JSON desde ${url}: ${errText.slice(0, 100)}` }],
      };
    }
    return await res.json();
  }

  async listPrompts(): Promise<MCPPrompt[]> {
    try {
      const url = getApiUrl(`/api/mcp/${this.name}/prompts`);
      const res = await fetch(url);
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) return [];
      const data = await res.json();
      return data.prompts || [];
    } catch {
      return [];
    }
  }

  async listResourceTemplates(): Promise<MCPResourceTemplate[]> {
    try {
      const url = getApiUrl(`/api/mcp/${this.name}/resource-templates`);
      const res = await fetch(url);
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) return [];
      const data = await res.json();
      return data.resourceTemplates || [];
    } catch {
      return [];
    }
  }

  async readResource(uri: string): Promise<string> {
    try {
      const url = getApiUrl(`/api/mcp/${this.name}/resources`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) return "";
      const data = await res.json();
      return data.text || "";
    } catch {
      return "";
    }
  }
}
