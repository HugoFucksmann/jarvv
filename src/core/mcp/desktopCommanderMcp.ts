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

  /**
   * Argumentos que Desktop Commander interpreta como ruta local (según los inputSchema de sus herramientas):
   * `path`, `paths[]` (read_multiple_files) y `source`/`destination` (move_file); además `directory` y `file`.
   * En read_file con isUrl=true, `path` es una URL http(s) y no se valida como ruta del sistema de archivos.
   */
  private collectPathArgs(args: Record<string, unknown>): string[] {
    const found: string[] = [];
    const add = (v: unknown) => {
      if (typeof v === "string" && v) found.push(v);
    };
    const isRemote = args.isUrl === true && typeof args.path === "string" && /^https?:\/\//i.test(args.path);
    if (!isRemote) add(args.path);
    add(args.directory);
    add(args.file);
    add(args.source);
    add(args.destination);
    if (Array.isArray(args.paths)) args.paths.forEach(add);
    return found;
  }

  private isPathAllowed(target: string): boolean {
    const resolvedTarget = path.resolve(target);
    return this.allowedDirectories.some((dir) => {
      const rel = path.relative(path.resolve(dir), resolvedTarget);
      // Una subcarpeta cuyo nombre empieza por ".." (p. ej. "..backup") está dentro; ".." o "../x" está fuera.
      return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    if (this.allowedDirectories.length > 0) {
      const denied = this.collectPathArgs(args).find((p) => !this.isPathAllowed(p));
      if (denied !== undefined) {
        return {
          isError: true,
          success: false,
          content: [
            {
              type: "text",
              text: `[DENIED] Acceso denegado: La ruta '${denied}' no pertenece a los allowedDirectories configurados (${this.allowedDirectories.join(", ")}).`,
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