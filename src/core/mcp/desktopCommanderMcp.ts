/**
 * Desktop Commander MCP — Real Client Adapter
 * Contract Reference: Desktop Commander MCP Contract
 * 
 * Rules:
 * - Real MCP transport over stdio JSON-RPC.
 * - Dynamic discovery via tools/list.
 * - Configurable allowedDirectories inspection (§10).
 * - Distinguishes [NOT_FOUND] vs [DENIED] (§6).
 * - Preserves process and session lifecycles (§7).
 * - Supports pagination and negative offsets (§5).
 * - NO in-memory simulated file dictionaries.
 */

import { IMCPServer } from "./types.ts";
import { MCPTool, MCPCallResult } from "../types.ts";
import { IMCPTransport, StdioMcpTransport } from "./transport.ts";
import { ConfigManager } from "../config.ts";

export class DesktopCommanderMCPServer implements IMCPServer {
  readonly name = "desktop_commander";
  readonly version = "2.1.0";
  private transport: IMCPTransport;
  private allowedDirectories: string[] = [];

  constructor(transport?: IMCPTransport, allowedDirs: string[] = []) {
    const config = ConfigManager.getConfig();
    this.transport = transport || new StdioMcpTransport(
      "desktop_commander",
      config.desktopCommanderMcp,
      config.timeoutMs
    );
    this.allowedDirectories = allowedDirs;
  }

  setAllowedDirectories(dirs: string[]): void {
    this.allowedDirectories = [...dirs];
  }

  getAllowedDirectories(): string[] {
    return [...this.allowedDirectories];
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  async reconnect(): Promise<void> {
    await this.transport.reconnect();
  }

  async listTools(): Promise<MCPTool[]> {
    return await this.transport.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    // If allowedDirectories is configured, enforce boundary checks (§10)
    const candidatePath = (args.path || args.directory || args.file) as string | undefined;
    if (this.allowedDirectories.length > 0 && typeof candidatePath === "string") {
      const targetPath = candidatePath.replace(/\\/g, "/");
      const isAllowed = this.allowedDirectories.some((dir) => {
        const normDir = dir.replace(/\\/g, "/").replace(/\/+$/, "");
        return targetPath.startsWith(normDir);
      });

      if (!isAllowed) {
        return {
          isError: true,
          success: false,
          content: [
            {
              type: "text",
              text: `[DENIED] Acceso denegado: La ruta '${candidatePath}' no pertenece a los allowedDirectories configurados (${this.allowedDirectories.join(", ")}).`,
            },
          ],
        };
      }
    }

    return await this.transport.callTool(name, args);
  }
}
