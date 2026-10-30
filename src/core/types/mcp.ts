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
  truncated?: boolean;
  [key: string]: unknown;
}