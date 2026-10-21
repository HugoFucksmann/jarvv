import { MCPTool, MCPCallResult } from "../types.ts";

export interface IMCPServer {
  readonly name: string;
  readonly version: string;
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult>;
  isConnected(): boolean;
  reconnect(): Promise<void>;
  close?(): Promise<void>;
}