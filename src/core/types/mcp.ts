/**
 * JARVIS Core — Contratos MCP.
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface MCPContentItem {
  type: string;
  text?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface MCPCallResult {
  content: MCPContentItem[];
  isError?: boolean;
  success?: boolean;
  search_incomplete?: boolean;
  truncated?: boolean;
  retrieved_at?: string;
  cache_age_seconds?: number;
  trimmed?: Record<string, unknown>;
  benched_engines?: string[];
  [key: string]: unknown;
}
