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
      await fetch(`/api/mcp/${this.name}/reconnect`, { method: "POST" });
    } catch (err) {
      console.warn(`[ClientMcpServer] Reconnect error for ${this.name}:`, err);
    }
  }

  async listTools(): Promise<MCPTool[]> {
    const res = await fetch(`/api/mcp/${this.name}/tools`);
    if (!res.ok) {
      throw new Error(`Error ${res.status} al obtener herramientas de '${this.name}'`);
    }
    const data = await res.json();
    return data.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const res = await fetch(`/api/mcp/${this.name}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        isError: true,
        success: false,
        content: [{ type: "text", text: `[MCP API Error ${res.status}] ${errText}` }],
      };
    }
    return await res.json();
  }

  async listPrompts(): Promise<MCPPrompt[]> {
    try {
      const res = await fetch(`/api/mcp/${this.name}/prompts`);
      const data = await res.json();
      return data.prompts || [];
    } catch {
      return [];
    }
  }

  async listResourceTemplates(): Promise<MCPResourceTemplate[]> {
    try {
      const res = await fetch(`/api/mcp/${this.name}/resource-templates`);
      const data = await res.json();
      return data.resourceTemplates || [];
    } catch {
      return [];
    }
  }

  async readResource(uri: string): Promise<string> {
    try {
      const res = await fetch(`/api/mcp/${this.name}/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri }),
      });
      const data = await res.json();
      return data.text || "";
    } catch {
      return "";
    }
  }
}
