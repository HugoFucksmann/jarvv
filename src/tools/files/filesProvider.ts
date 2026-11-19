/**
 * Proveedor nativo `jarvis_files`: herramientas de solo lectura `find_files`, `list_folder` y `system_info`.
 *
 * Etapa 1: registradas como internas en el catálogo (`src/core/tools/manifest.ts`) para probarlas sin
 * exponerlas aún a D1 ni D2. Todas las dependencias externas (entorno del usuario, directorios permitidos,
 * lectores del sistema y reloj) entran por opciones para poder probarlas sin Windows.
 */

import { getUserEnvironment, type UserEnvironment } from "../../core/environment.ts";
import type { ToolCallOptions, ToolProvider } from "../../core/tools/provider.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult, MCPTool } from "../../core/types.ts";
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
import {
  createDefaultSystemReader,
  DEFAULT_SERVICES_LIMIT,
  DEFAULT_SYSTEM_TIMEOUT_MS,
  MAX_SERVICES_LIMIT,
  runSystemInfo,
  SERVICE_STATUS_FILTERS,
  SYSTEM_SECTIONS,
  type SystemReader,
} from "./systemInfo.ts";

export const FILES_SERVER = "jarvis_files";
export const FIND_FILES = "find_files";
export const LIST_FOLDER = "list_folder";
export const SYSTEM_INFO = "system_info";

export type { DiskInfo, DevToolInfo, HostOsInfo, ServiceInfo, SystemReader } from "./systemInfo.ts";

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

const SYSTEM_INFO_TOOL: MCPTool = {
  name: SYSTEM_INFO,
  description: "Report hardware, OS, disks, services or installed dev tools of this PC.",
  inputSchema: {
    type: "object",
    properties: {
      section: {
        type: "string",
        enum: [...SYSTEM_SECTIONS],
        description: "Section to inspect: 'overview', 'hardware', 'os', 'disks', 'services', or 'dev_tools'.",
      },
      status: {
        type: "string",
        enum: [...SERVICE_STATUS_FILTERS],
        description: "Only for 'services': filter by 'running' (default), 'stopped', or 'all'.",
      },
      limit: {
        type: "integer",
        description: `Only for 'services': maximum services to list (default ${DEFAULT_SERVICES_LIMIT}, max ${MAX_SERVICES_LIMIT}).`,
      },
    },
    required: ["section"],
    additionalProperties: false,
  },
};

const TOOLS: readonly MCPTool[] = [FIND_FILES_TOOL, LIST_FOLDER_TOOL, SYSTEM_INFO_TOOL];

const fail = (message: string): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false }, isError: true });

export interface FilesProviderOptions {
  /** Carpetas permitidas leídas en vivo (vacío = sin restricción). */
  readonly allowedDirectories?: () => readonly string[];
  /** Carpetas conocidas del usuario (`home`, `desktop`, `documents`, `downloads`). */
  readonly environment?: () => Promise<UserEnvironment>;
  /** Lectores del sistema (GPU, discos, servicios, dev tools, host OS); reemplazable en pruebas. */
  readonly systemReader?: Partial<SystemReader>;
  /** Reloj inyectable para pruebas de plazos. */
  readonly now?: () => number;
  /** Plataforma del sistema (por defecto `process.platform`). */
  readonly platform?: NodeJS.Platform;
  /** Límites configurables de `find_files` (útiles en pruebas). */
  readonly findTimeoutMs?: number;
  readonly findMaxDepth?: number;
  readonly findMaxEntries?: number;
  readonly listTimeoutMs?: number;
  readonly systemTimeoutMs?: number;
}

export class FilesProvider implements ToolProvider {
  readonly name = FILES_SERVER;
  readonly version = "1.0.0";

  private readonly getAllowedDirectories: () => readonly string[];
  private readonly getEnvironment: () => Promise<UserEnvironment>;
  private readonly reader: SystemReader;
  private readonly now: () => number;
  private readonly findTimeoutMs: number;
  private readonly findMaxDepth: number;
  private readonly findMaxEntries: number;
  private readonly listTimeoutMs: number;
  private readonly systemTimeoutMs: number;

  constructor(options: FilesProviderOptions = {}) {
    this.getAllowedDirectories = options.allowedDirectories ?? (() => []);
    this.getEnvironment = options.environment ?? getUserEnvironment;
    this.now = options.now ?? (() => Date.now());
    this.findTimeoutMs = options.findTimeoutMs ?? DEFAULT_FIND_TIMEOUT_MS;
    this.findMaxDepth = options.findMaxDepth ?? DEFAULT_FIND_MAX_DEPTH;
    this.findMaxEntries = options.findMaxEntries ?? DEFAULT_FIND_MAX_ENTRIES;
    this.listTimeoutMs = options.listTimeoutMs ?? DEFAULT_LIST_TIMEOUT_MS;
    this.systemTimeoutMs = options.systemTimeoutMs ?? DEFAULT_SYSTEM_TIMEOUT_MS;

    const defaults = createDefaultSystemReader(options.platform ?? process.platform, this.systemTimeoutMs);
    this.reader = {
      readHost: options.systemReader?.readHost ?? defaults.readHost,
      readGpus: options.systemReader?.readGpus ?? defaults.readGpus,
      readDisks: options.systemReader?.readDisks ?? defaults.readDisks,
      readServices: options.systemReader?.readServices ?? defaults.readServices,
      readDevTools: options.systemReader?.readDevTools ?? defaults.readDevTools,
    };
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
      case SYSTEM_INFO:
        return runSystemInfo(
          args,
          {
            reader: this.reader,
            defaultTimeoutMs: this.systemTimeoutMs,
          },
          { signal: options.signal },
        );
      default:
        return fail(`Unknown tool: '${name}'.`);
    }
  }
}
