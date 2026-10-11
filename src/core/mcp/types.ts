import { MCPTool, MCPCallResult } from "../types.ts";

export interface MCPPrompt {
  name: string;
  description: string;
}

export interface MCPResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
}

export interface IMCPServer {
  readonly name: string;
  readonly version: string;
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult>;
  isConnected(): boolean;
  reconnect(): Promise<void>;
  close?(): Promise<void>;
  listPrompts?(): Promise<MCPPrompt[]>;
  listResourceTemplates?(): Promise<MCPResourceTemplate[]>;
  readResource?(uri: string): Promise<string>;
}