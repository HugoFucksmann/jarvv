/**
 * Windows MCP — Real Client Adapter
 * Contract Reference: sbroenne/mcp-windows (v1.3.27)
 */

import { IMCPServer } from "./types.ts";
import { MCPTool, MCPCallResult } from "../types.ts";
import { IMCPTransport, StdioMcpTransport } from "./transport.ts";
import { ConfigManager } from "../config.ts";

export class WindowsMCPServer implements IMCPServer {
  readonly name = "windows";
  readonly version = "1.3.27";
  private transport: IMCPTransport;
  private currentSessionToken: string = "";

  constructor(transport?: IMCPTransport) {
    const config = ConfigManager.getConfig();
    this.transport = transport || new StdioMcpTransport(
      "windows",
      config.windowsMcp,
      config.mcpTimeoutMs ?? 30000
    );
    this.currentSessionToken = `win_${Date.now()}`;
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  async reconnect(): Promise<void> {
    this.currentSessionToken = `win_${Date.now()}`;
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
    try {
      const result = await this.transport.callTool(name, args);
      const contentText = (result.content || [])
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .join(" ")
        .toLowerCase();
      if (
        result.isError &&
        (contentText.includes("stale") ||
          contentText.includes("element not found") ||
          contentText.includes("invalid id") ||
          contentText.includes("invalid element"))
      ) {
        result.staleElement = true;
      }
      return result;
    } catch (err: any) {
      const errStr = (err.message || "").toLowerCase();
      if (errStr.includes("stale") || errStr.includes("not found") || errStr.includes("invalid id")) {
        return {
          isError: true,
          success: false,
          staleElement: true,
          content: [
            {
              type: "text",
              text: `[STALE_ELEMENT] El elemento indicado ha cambiado o ya no es accesible en la interfaz: ${err.message}`,
            },
          ],
        };
      }
      throw err;
    }
  }

  getSessionToken(): string {
    return this.currentSessionToken;
  }
}