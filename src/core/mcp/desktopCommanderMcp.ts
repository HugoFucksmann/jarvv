/**
 * Desktop Commander MCP — Real Client Adapter
 * Contract Reference: Desktop Commander MCP Contract
 */

import path from "node:path";
import { IMCPServer, MCPPrompt, MCPResourceTemplate } from "./types.ts";
import { MCPTool, MCPCallResult } from "../types.ts";
import { IMCPTransport, StdioMcpTransport } from "./transport.ts";
import { ConfigManager } from "../config.ts";

export class DesktopCommanderMCPServer implements IMCPServer {
  readonly name = "desktop_commander";
  readonly version = "2.1.0";
  private transport: IMCPTransport;
  private allowedDirectories: string[] = [];

  constructor(transport?: IMCPTransport, allowedDirs?: string[]) {
    const config = ConfigManager.getConfig();
    this.transport = transport || new StdioMcpTransport(
      "desktop_commander",
      config.desktopCommanderMcp,
      config.mcpTimeoutMs ?? 30000
    );
    this.allowedDirectories = allowedDirs || config.desktopCommanderMcp?.allowedDirectories || [];
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

  async close(): Promise<void> {
    if (this.transport.close) {
      await this.transport.close();
    }
  }

  async listTools(): Promise<MCPTool[]> {
    return await this.transport.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const candidatePath = (args.path || args.directory || args.file) as string | undefined;
    if (this.allowedDirectories.length > 0 && typeof candidatePath === "string") {
      const resolvedTarget = path.resolve(candidatePath);
      const isAllowed = this.allowedDirectories.some((dir) => {
        const resolvedDir = path.resolve(dir);
        const rel = path.relative(resolvedDir, resolvedTarget);
        return !rel.startsWith("..") && !path.isAbsolute(rel);
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
}