/**
 * free-search-mcp — Real Client Adapter
 * Contract Reference: sweetcornna/free-search-mcp (v0.13.1)
 */

import { IMCPServer } from "./types.ts";
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
      config.mcpTimeoutMs ?? 30000
    );
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  async reconnect(): Promise<void> {
    await this.transport.reconnect();
  }

  async close(): Promise<void> {
    if (this.transport.close) {
      await this.transport.close();
    }
  }



  async listTools(): Promise<MCPTool[]> {
    return await this.transport.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    return await this.transport.callTool(name, args);
  }
}