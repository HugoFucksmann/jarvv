/**
 * Base de los servidores MCP cuyo transporte es un proceso stdio: delega en él la conexión, el listado y las llamadas.
 * Cada servidor concreto fija su nombre y versión y puede filtrar las llamadas antes de delegar.
 */

import type { MCPCallResult, MCPTool } from "../types.ts";
import type { IMCPServer } from "./types.ts";
import type { IMCPTransport } from "./transport.ts";

export abstract class StdioMcpServer implements IMCPServer {
  abstract readonly name: string;
  abstract readonly version: string;

  constructor(protected readonly transport: IMCPTransport) {}

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  async reconnect(): Promise<void> {
    await this.transport.reconnect();
  }

  async close(): Promise<void> {
    await this.transport.close?.();
  }

  listTools(): Promise<MCPTool[]> {
    return this.transport.listTools();
  }

  callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    return this.transport.callTool(name, args);
  }
}
