/**
 * Adaptador del servidor MCP Desktop Commander. Antes de delegar en el transporte, rechaza con `[DENIED]` (prefijo que
 * reconoce ResultProcessor) los argumentos de ruta fuera de `allowedDirectories`; con la lista vacía no restringe nada.
 *
 * En Windows, además, un `start_process` en PowerShell sale con la salida en UTF-8 (`utf8Command`): Desktop Commander decodifica la
 * salida del shell como UTF-8 (`data.toString()`) y PowerShell 5.1 escribe en la página de códigos OEM (850 en es-AR), así que
 * `ó` llegaba como `�`. El cambio vale solo para lo que se despacha: la traza y el contexto conservan el comando original.
 */

import path from "node:path";
import { MCPCallResult } from "../types.ts";
import { IMCPTransport, StdioMcpTransport } from "./transport.ts";
import { StdioMcpServer } from "./stdioServer.ts";
import type { ConfigSource } from "../config.ts";

/** Antepone al comando de PowerShell la salida en UTF-8; en otros sistemas, con otro shell o sin comando, lo deja igual. */
export function utf8Command(args: Record<string, unknown>, platform: NodeJS.Platform = process.platform): Record<string, unknown> {
  const shell = typeof args.shell === "string" ? args.shell.toLowerCase().replace(/\.exe$/, "") : undefined;
  if (platform !== "win32" || typeof args.command !== "string" || (shell !== undefined && shell !== "powershell" && shell !== "pwsh")) return args;
  return { ...args, command: `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${args.command}` };
}

export class DesktopCommanderMCPServer extends StdioMcpServer {
  readonly name = "desktop_commander";
  readonly version = "2.1.0";
  private readonly allowedDirectories: string[];

  constructor(getConfig: ConfigSource, transport?: IMCPTransport, allowedDirs?: string[]) {
    const config = getConfig().desktopCommanderMcp;
    super(transport ?? new StdioMcpTransport("desktop_commander", config, () => getConfig().mcpTimeoutMs));
    this.allowedDirectories = allowedDirs ?? config.allowedDirectories ?? [];
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

    return super.callTool(name, name === "start_process" ? utf8Command(args) : args);
  }
}