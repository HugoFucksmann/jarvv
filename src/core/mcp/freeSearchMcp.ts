/**
 * Adaptador del servidor MCP free-search (0.18.0, la versión fijada en config.ts). Sin lógica propia: delega en el
 * transporte.
 */

import type { ConfigSource } from "../config.ts";
import { IMCPTransport, StdioMcpTransport } from "./transport.ts";
import { StdioMcpServer } from "./stdioServer.ts";

export class FreeSearchMCPServer extends StdioMcpServer {
  readonly name = "free_search";
  readonly version = "0.18.0";

  constructor(getConfig: ConfigSource, transport?: IMCPTransport) {
    super(transport ?? new StdioMcpTransport("free_search", getConfig().freeSearchMcp, () => getConfig().mcpTimeoutMs));
  }
}