/**
 * Proveedor nativo `jarvis_files_read` (grupo `files_read`: `find_files`, `list_folder`, `search_content`, `read_file`).
 *
 * Aislado del grupo de escritura (`jarvis_files_write`) y de los demás proveedores: cada uno vive en su carpeta.
 * Todas las dependencias externas entran por opciones para pruebas deterministas.
 */

import { getUserEnvironment, type UserEnvironment } from "../../core/environment.ts";
import type { ToolCallOptions, ToolProvider } from "../../core/tools/provider.ts";
import { toolFail as fail } from "../../core/tools/result.ts";
import {
  DEFAULT_FIND_MAX_DEPTH,
  DEFAULT_FIND_MAX_ENTRIES,
  DEFAULT_FIND_MAX_RESULTS,
  DEFAULT_FIND_TIMEOUT_MS,
  MAX_FIND_RESULTS,
  runFindFiles,
} from "./findFiles.ts";
import {
  DEFAULT_LIST_DEPTH,
  DEFAULT_LIST_LIMIT,
  DEFAULT_LIST_TIMEOUT_MS,
  MAX_LIST_DEPTH,
  MAX_LIST_LIMIT,
  runListFolder,
} from "./listFolder.ts";
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

const FILES_READ_SERVER = "jarvis_files_read";
const READ_FILE = "read_file";
const SEARCH_CONTENT = "search_content";
const FIND_FILES = "find_files";
const LIST_FOLDER = "list_folder";

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

const FIND_FILES_TOOL: MCPTool = {
  name: FIND_FILES,
  description: "Find files or folders by name (wildcards like *.csv). Not for text inside files.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "Name or text to match. Without * or ?, matches substring (case-insensitive). With * or ?, matches full name. Use | for alternatives (e.g. *.csv|*.json). Plain wildcards only, no regex.",
      },
      path: {
        type: "string",
        description: "Folder to search in. Default: user home. Accepts aliases (home, desktop, documents, downloads) or an absolute path.",
      },
      type: {
        type: "string",
        enum: ["file", "folder", "any"],
        description: "Entry type to find: 'file', 'folder', or 'any' (default 'any').",
      },
      maxResults: {
        type: "integer",
        description: `Maximum results to return (default ${DEFAULT_FIND_MAX_RESULTS}, max ${MAX_FIND_RESULTS}).`,
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
};

const LIST_FOLDER_TOOL: MCPTool = {
  name: LIST_FOLDER,
  description: "List a folder with type, size and date; can sort and filter by extension.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Folder to list. Accepts aliases (home, desktop, documents, downloads) or an absolute path.",
      },
      sortBy: {
        type: "string",
        enum: ["name", "size", "modified"],
        description: "Sort field: 'name' (default), 'size', or 'modified'.",
      },
      order: {
        type: "string",
        enum: ["asc", "desc"],
        description: "Sort order: 'asc' or 'desc'. Default is 'asc' for name, 'desc' for size and modified.",
      },
      type: {
        type: "string",
        enum: ["file", "folder", "any"],
        description: "Entry type filter: 'file', 'folder', or 'any' (default 'any').",
      },
      extensions: {
        type: "array",
        items: { type: "string" },
        description: 'Optional list of file extensions without dots, e.g. ["csv", "json"].',
      },
      depth: {
        type: "integer",
        description: `Subfolder depth to traverse (integer >= 1; default ${DEFAULT_LIST_DEPTH}, max ${MAX_LIST_DEPTH}).`,
      },
      limit: {
        type: "integer",
        description: `Maximum entries to show (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}).`,
      },
      includeHidden: {
        type: "boolean",
        description: "Include hidden files and dotfiles (default false).",
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

const TOOLS: readonly MCPTool[] = [FIND_FILES_TOOL, LIST_FOLDER_TOOL, SEARCH_CONTENT_TOOL, READ_FILE_TOOL];

interface FilesReadProviderOptions {
  readonly allowedDirectories?: () => readonly string[];
  readonly environment?: () => Promise<UserEnvironment>;
  readonly now?: () => number;
  readonly readDrivers?: readonly ReadFileDriver[];
  readonly searchTimeoutMs?: number;
  readonly searchMaxDepth?: number;
  readonly searchMaxFiles?: number;
  readonly searchMaxFileBytes?: number;
  readonly findTimeoutMs?: number;
  readonly findMaxDepth?: number;
  readonly findMaxEntries?: number;
  readonly listTimeoutMs?: number;
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
  private readonly findTimeoutMs: number;
  private readonly findMaxDepth: number;
  private readonly findMaxEntries: number;
  private readonly listTimeoutMs: number;

  constructor(options: FilesReadProviderOptions = {}) {
    this.getAllowedDirectories = options.allowedDirectories ?? (() => []);
    this.getEnvironment = options.environment ?? getUserEnvironment;
    this.now = options.now ?? (() => Date.now());
    this.readDrivers = options.readDrivers;
    this.searchTimeoutMs = options.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    this.searchMaxDepth = options.searchMaxDepth ?? DEFAULT_SEARCH_MAX_DEPTH;
    this.searchMaxFiles = options.searchMaxFiles ?? DEFAULT_SEARCH_MAX_FILES;
    this.searchMaxFileBytes = options.searchMaxFileBytes ?? DEFAULT_SEARCH_MAX_FILE_BYTES;
    this.findTimeoutMs = options.findTimeoutMs ?? DEFAULT_FIND_TIMEOUT_MS;
    this.findMaxDepth = options.findMaxDepth ?? DEFAULT_FIND_MAX_DEPTH;
    this.findMaxEntries = options.findMaxEntries ?? DEFAULT_FIND_MAX_ENTRIES;
    this.listTimeoutMs = options.listTimeoutMs ?? DEFAULT_LIST_TIMEOUT_MS;
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
      case FIND_FILES:
        return runFindFiles(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            now: this.now,
            defaultTimeoutMs: this.findTimeoutMs,
            maxDepth: this.findMaxDepth,
            maxEntries: this.findMaxEntries,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      case LIST_FOLDER:
        return runListFolder(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            now: this.now,
            defaultTimeoutMs: this.listTimeoutMs,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
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
