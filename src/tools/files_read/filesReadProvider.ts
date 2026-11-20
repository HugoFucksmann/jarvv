/**
 * Proveedor nativo `jarvis_files_read` (grupo de solo lectura de archivos).
 *
 * Aislado del grupo de escritura (`jarvis_files_write`) y sin integración aún a D1/D2.
 * Todas las dependencias externas entran por opciones para pruebas deterministas.
 */

import { getUserEnvironment, type UserEnvironment } from "../../core/environment.ts";
import type { ToolCallOptions, ToolProvider } from "../../core/tools/provider.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult, MCPTool } from "../../core/types.ts";
import {
  DEFAULT_READ_LIMIT,
  DEFAULT_READ_OFFSET,
  MAX_READ_LIMIT,
  runReadFile,
  type ReadFileDriver,
} from "./readFile.ts";
import {
  DEFAULT_MAX_MATCHES_PER_FILE,
  DEFAULT_SEARCH_MAX_DEPTH,
  DEFAULT_SEARCH_MAX_FILE_BYTES,
  DEFAULT_SEARCH_MAX_FILES,
  DEFAULT_SEARCH_MAX_RESULTS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_SEARCH_RESULTS,
  runSearchContent,
} from "./searchContent.ts";

export const FILES_READ_SERVER = "jarvis_files_read";
export const READ_FILE = "read_file";
export const SEARCH_CONTENT = "search_content";

export type { ReadDriverContext, ReadFileDriver } from "./readFile.ts";

const READ_FILE_TOOL: MCPTool = {
  name: READ_FILE,
  description: "Read file contents by type (plain text lines now, extensible to PDF/Office/images).",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute file path or ~ relative path.",
      },
      offset: {
        type: "integer",
        description: `1-based starting line number (default ${DEFAULT_READ_OFFSET}).`,
      },
      limit: {
        type: "integer",
        description: `Maximum lines to read (default ${DEFAULT_READ_LIMIT}, max ${MAX_READ_LIMIT}).`,
      },
      encoding: {
        type: "string",
        enum: ["utf8", "latin1"],
        description: "Text encoding (default 'utf8').",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

const SEARCH_CONTENT_TOOL: MCPTool = {
  name: SEARCH_CONTENT,
  description: "Search for text or regex inside files under a folder or file path.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text or regular expression to search for.",
      },
      path: {
        type: "string",
        description: "Folder or file to search in. Default: home. Accepts aliases (home, desktop, documents, downloads) or absolute path.",
      },
      filePattern: {
        type: "string",
        description: "Optional file name wildcard filter, e.g. '*.ts|*.json'.",
      },
      regex: {
        type: "boolean",
        description: "Interpret query as regular expression (default false).",
      },
      caseSensitive: {
        type: "boolean",
        description: "Case-sensitive search (default false).",
      },
      maxResults: {
        type: "integer",
        description: `Maximum matches to return (default ${DEFAULT_SEARCH_MAX_RESULTS}, max ${MAX_SEARCH_RESULTS}).`,
      },
      maxMatchesPerFile: {
        type: "integer",
        description: `Maximum matches per file (default ${DEFAULT_MAX_MATCHES_PER_FILE}).`,
      },
      includeHidden: {
        type: "boolean",
        description: "Include dotfiles and dot-folders (default false).",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const TOOLS: readonly MCPTool[] = [READ_FILE_TOOL, SEARCH_CONTENT_TOOL];

const fail = (message: string): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false }, isError: true });

export interface FilesReadProviderOptions {
  readonly allowedDirectories?: () => readonly string[];
  readonly environment?: () => Promise<UserEnvironment>;
  readonly now?: () => number;
  readonly readDrivers?: readonly ReadFileDriver[];
  readonly searchTimeoutMs?: number;
  readonly searchMaxDepth?: number;
  readonly searchMaxFiles?: number;
  readonly searchMaxFileBytes?: number;
}

export class FilesReadProvider implements ToolProvider {
  readonly name = FILES_READ_SERVER;
  readonly version = "1.0.0";

  private readonly getAllowedDirectories: () => readonly string[];
  private readonly getEnvironment: () => Promise<UserEnvironment>;
  private readonly now: () => number;
  private readonly readDrivers: readonly ReadFileDriver[] | undefined;
  private readonly searchTimeoutMs: number;
  private readonly searchMaxDepth: number;
  private readonly searchMaxFiles: number;
  private readonly searchMaxFileBytes: number;

  constructor(options: FilesReadProviderOptions = {}) {
    this.getAllowedDirectories = options.allowedDirectories ?? (() => []);
    this.getEnvironment = options.environment ?? getUserEnvironment;
    this.now = options.now ?? (() => Date.now());
    this.readDrivers = options.readDrivers;
    this.searchTimeoutMs = options.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    this.searchMaxDepth = options.searchMaxDepth ?? DEFAULT_SEARCH_MAX_DEPTH;
    this.searchMaxFiles = options.searchMaxFiles ?? DEFAULT_SEARCH_MAX_FILES;
    this.searchMaxFileBytes = options.searchMaxFileBytes ?? DEFAULT_SEARCH_MAX_FILE_BYTES;
  }

  async listTools(): Promise<MCPTool[]> {
    return [...TOOLS];
  }

  isConnected(): boolean {
    return true;
  }

  async reconnect(): Promise<void> {}

  async callTool(name: string, args: Record<string, unknown>, options: ToolCallOptions = {}): Promise<MCPCallResult> {
    switch (name) {
      case READ_FILE:
        return runReadFile(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            drivers: this.readDrivers,
          },
          { signal: options.signal },
        );
      case SEARCH_CONTENT:
        return runSearchContent(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            now: this.now,
            defaultTimeoutMs: this.searchTimeoutMs,
            maxDepth: this.searchMaxDepth,
            maxFiles: this.searchMaxFiles,
            maxFileBytes: this.searchMaxFileBytes,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      default:
        return fail(`Unknown tool: '${name}'.`);
    }
  }
}
