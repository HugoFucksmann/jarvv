/**
 * free-search-mcp — Real Client Adapter
 * Contract Reference: sweetcornna/free-search-mcp (v0.13.1)
 * 
 * Rules:
 * - Real MCP transport over stdio JSON-RPC.
 * - Dynamic discovery via tools/list, prompts/list, resources/templates/list (§3, §7).
 * - Real tools/call execution.
 * - Web content is treated strictly as DATA, not instructions (§14, §28).
 * - NO simulated mock search results.
 */

import { IMCPServer, MCPPrompt, MCPResourceTemplate } from "./types.ts";
import { MCPTool, MCPCallResult } from "../types.ts";
import { IMCPTransport, StdioMcpTransport } from "./transport.ts";
import { ConfigManager } from "../config.ts";

export class FreeSearchMCPServer implements IMCPServer {
  readonly name = "free_search";
  readonly version = "0.13.1";
  private transport: IMCPTransport;

  constructor(transport?: IMCPTransport) {
    const config = ConfigManager.getConfig();
    this.transport = transport || new StdioMcpTransport(
      "free_search",
      config.freeSearchMcp,
      config.timeoutMs
    );
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  async reconnect(): Promise<void> {
    await this.transport.reconnect();
  }

  async listPrompts(): Promise<MCPPrompt[]> {
    if (this.transport.listPrompts) {
      return await this.transport.listPrompts();
    }
    return [];
  }

  async listResourceTemplates(): Promise<MCPResourceTemplate[]> {
    if (this.transport.listResourceTemplates) {
      return await this.transport.listResourceTemplates();
    }
    return [];
  }

  async readResource(uri: string): Promise<string> {
    if (this.transport.readResource) {
      return await this.transport.readResource(uri);
    }
    return "";
  }

  async listTools(): Promise<MCPTool[]> {
    return await this.transport.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    return await this.transport.callTool(name, args);
  }
}
