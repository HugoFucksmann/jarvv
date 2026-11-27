/**
 * Proveedor nativo `jarvis_files_write` (grupo de escritura y manipulación de archivos).
 *
 * Aislado de `jarvis_files_read` (`files_read/`) y sin integración aún a D1/D2.
 * Todas las dependencias externas (entorno, directorios permitidos, reloj, papelera,
 * drivers por formato) se inyectan por opciones para poder probar sin Windows.
 */

import { getUserEnvironment, type UserEnvironment } from "../../core/environment.ts";
import type { ToolCallOptions, ToolProvider } from "../../core/tools/provider.ts";
import { toolFail as fail } from "../../core/tools/result.ts";
import type { MCPCallResult, MCPTool } from "../../core/types.ts";
import {
  DEFAULT_ARCHIVE_MAX_ENTRIES,
  DEFAULT_ARCHIVE_MAX_EXTRACT_BYTES,
  DEFAULT_ARCHIVE_MAX_INPUT_BYTES,
  DEFAULT_ARCHIVE_TIMEOUT_MS,
  runArchiveFiles,
} from "./archiveFiles.ts";
import { DEFAULT_CONVERT_TIMEOUT_MS, runConvertFile, type ConvertDriver } from "./convertFile.ts";
import {
  DEFAULT_COPY_MAX_BYTES,
  DEFAULT_COPY_MAX_ENTRIES,
  DEFAULT_COPY_TIMEOUT_MS,
  runCopyFile,
} from "./copyFile.ts";
import { runCreateFolder } from "./createFolder.ts";
import { DEFAULT_DELETE_TIMEOUT_MS, runDeleteFile, type TrashHandler } from "./deleteFile.ts";
import { DEFAULT_EDIT_MAX_FILE_BYTES, runEditFile } from "./editFile.ts";
import { MAX_MOVE_ITEMS, runMoveFile } from "./moveFile.ts";
import { runWriteFile, type WriteFileDriver } from "./writeFile.ts";

const FILES_WRITE_SERVER = "jarvis_files_write";
const CREATE_FOLDER = "create_folder";
const WRITE_FILE = "write_file";
const EDIT_FILE = "edit_file";
const COPY_FILE = "copy_file";
const MOVE_FILE = "move_file";
const DELETE_FILE = "delete_file";
const ARCHIVE_FILES = "archive_files";
const CONVERT_FILE = "convert_file";

export type { ConvertDriver, ConvertRequest, ConvertResultInfo } from "./convertFile.ts";
export type { TrashHandler } from "./deleteFile.ts";
export type { WriteDriverContext, WriteFileDriver, WriteMode } from "./writeFile.ts";

const CREATE_FOLDER_TOOL: MCPTool = {
  name: CREATE_FOLDER,
  description: "Create a folder (including missing parent folders).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute folder path or ~ relative path." },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

const WRITE_FILE_TOOL: MCPTool = {
  name: WRITE_FILE,
  description: "Create or write a file by type (plain text now, extensible to Office/PDF).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute file path or ~ relative path." },
      content: { type: "string", description: "Content to write into the file." },
      mode: {
        type: "string",
        enum: ["rewrite", "append", "create_only"],
        description: "Write mode: 'rewrite' (default; replaces the whole file, send the COMPLETE content), 'append' (adds ONLY the new lines at the end; never resend existing content), or 'create_only'.",
      },
      createFolders: {
        type: "boolean",
        description: "Create missing parent folders automatically (default false).",
      },
      encoding: {
        type: "string",
        enum: ["utf8", "latin1"],
        description: "Text encoding (default 'utf8').",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
};

const EDIT_FILE_TOOL: MCPTool = {
  name: EDIT_FILE,
  description: "Replace exact text inside an existing text file without rewriting the whole file.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Existing text file path." },
      oldText: { type: "string", description: "Exact text fragment to replace (must be non-empty)." },
      newText: { type: "string", description: "Replacement text (may be empty to remove oldText)." },
      replaceAll: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match (default false)." },
      expectedReplacements: { type: "integer", description: "Optional expected number of replacements (>= 1)." },
    },
    required: ["path", "oldText", "newText"],
    additionalProperties: false,
  },
};

const COPY_FILE_TOOL: MCPTool = {
  name: COPY_FILE,
  description: "Copy a file or folder to a destination path.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "Existing source file or folder path." },
      destination: { type: "string", description: "Target destination path." },
      overwrite: { type: "boolean", description: "Overwrite destination if it exists (default false)." },
      recursive: { type: "boolean", description: "Copy folder contents recursively (default true)." },
    },
    required: ["source", "destination"],
    additionalProperties: false,
  },
};

const MOVE_FILE_TOOL: MCPTool = {
  name: MOVE_FILE,
  description: `Move or rename files and folders in batch (1 to ${MAX_MOVE_ITEMS} items).`,
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            source: { type: "string", description: "Existing source path." },
            destination: { type: "string", description: "Target destination path." },
          },
          required: ["source", "destination"],
          additionalProperties: false,
        },
        description: "List of { source, destination } pairs to move or rename.",
      },
      overwrite: { type: "boolean", description: "Overwrite existing destinations (default false)." },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

const DELETE_FILE_TOOL: MCPTool = {
  name: DELETE_FILE,
  description: "Delete a file or folder (sends to Recycle Bin on Windows by default unless permanent=true).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Existing file or folder path to delete." },
      recursive: { type: "boolean", description: "Required true when deleting a non-empty folder (default false)." },
      permanent: { type: "boolean", description: "Delete permanently instead of sending to Recycle Bin (default false)." },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

const ARCHIVE_FILES_TOOL: MCPTool = {
  name: ARCHIVE_FILES,
  description: "Compress files or folders into a .zip archive, or extract an existing .zip archive safely.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["compress", "extract"],
        description: "Operation: 'compress' or 'extract'.",
      },
      sources: {
        type: "array",
        items: { type: "string" },
        description: "File or folder paths to compress (required when action='compress').",
      },
      source: {
        type: "string",
        description: "Existing .zip archive path to extract (required when action='extract').",
      },
      destination: {
        type: "string",
        description: "Output .zip file path (for 'compress') or target folder path (for 'extract').",
      },
      overwrite: {
        type: "boolean",
        description: "Overwrite existing destination file(s) (default false).",
      },
      includeHidden: {
        type: "boolean",
        description: "Include dotfiles when compressing folders (default false).",
      },
    },
    required: ["action", "destination"],
    additionalProperties: false,
  },
};

const CONVERT_FILE_TOOL: MCPTool = {
  name: CONVERT_FILE,
  description: "Convert or resize image, audio, or video files.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "Existing source media file path." },
      destination: { type: "string", description: "Optional target output file path." },
      format: { type: "string", description: "Target format extension (e.g. 'webp', 'png', 'mp3', 'mp4')." },
      width: { type: "integer", description: "Optional target width in pixels (images/video)." },
      height: { type: "integer", description: "Optional target height in pixels (images/video)." },
      quality: { type: "integer", description: "Optional output quality 1..100." },
      overwrite: { type: "boolean", description: "Overwrite existing destination (default false)." },
    },
    required: ["source"],
    additionalProperties: false,
  },
};

const TOOLS: readonly MCPTool[] = [
  CREATE_FOLDER_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  COPY_FILE_TOOL,
  MOVE_FILE_TOOL,
  DELETE_FILE_TOOL,
  ARCHIVE_FILES_TOOL,
  CONVERT_FILE_TOOL,
];

interface FilesWriteProviderOptions {
  readonly allowedDirectories?: () => readonly string[];
  readonly environment?: () => Promise<UserEnvironment>;
  readonly now?: () => number;
  readonly platform?: NodeJS.Platform;
  readonly trashHandler?: TrashHandler;
  readonly writeDrivers?: readonly WriteFileDriver[];
  readonly convertDriver?: ConvertDriver;
  readonly editMaxFileBytes?: number;
  readonly copyTimeoutMs?: number;
  readonly copyMaxEntries?: number;
  readonly copyMaxBytes?: number;
  readonly deleteTimeoutMs?: number;
  readonly archiveTimeoutMs?: number;
  readonly archiveMaxEntries?: number;
  readonly archiveMaxInputBytes?: number;
  readonly archiveMaxExtractBytes?: number;
  readonly convertTimeoutMs?: number;
}

export class FilesWriteProvider implements ToolProvider {
  readonly name = FILES_WRITE_SERVER;
  readonly version = "1.0.0";

  private readonly getAllowedDirectories: () => readonly string[];
  private readonly getEnvironment: () => Promise<UserEnvironment>;
  private readonly now: () => number;
  private readonly platform: NodeJS.Platform;
  private readonly trashHandler: TrashHandler | undefined;
  private readonly writeDrivers: readonly WriteFileDriver[] | undefined;
  private readonly convertDriver: ConvertDriver | undefined;
  private readonly editMaxFileBytes: number;
  private readonly copyTimeoutMs: number;
  private readonly copyMaxEntries: number;
  private readonly copyMaxBytes: number;
  private readonly deleteTimeoutMs: number;
  private readonly archiveTimeoutMs: number;
  private readonly archiveMaxEntries: number;
  private readonly archiveMaxInputBytes: number;
  private readonly archiveMaxExtractBytes: number;
  private readonly convertTimeoutMs: number;

  constructor(options: FilesWriteProviderOptions = {}) {
    this.getAllowedDirectories = options.allowedDirectories ?? (() => []);
    this.getEnvironment = options.environment ?? getUserEnvironment;
    this.now = options.now ?? (() => Date.now());
    this.platform = options.platform ?? process.platform;
    this.trashHandler = options.trashHandler;
    this.writeDrivers = options.writeDrivers;
    this.convertDriver = options.convertDriver;
    this.editMaxFileBytes = options.editMaxFileBytes ?? DEFAULT_EDIT_MAX_FILE_BYTES;
    this.copyTimeoutMs = options.copyTimeoutMs ?? DEFAULT_COPY_TIMEOUT_MS;
    this.copyMaxEntries = options.copyMaxEntries ?? DEFAULT_COPY_MAX_ENTRIES;
    this.copyMaxBytes = options.copyMaxBytes ?? DEFAULT_COPY_MAX_BYTES;
    this.deleteTimeoutMs = options.deleteTimeoutMs ?? DEFAULT_DELETE_TIMEOUT_MS;
    this.archiveTimeoutMs = options.archiveTimeoutMs ?? DEFAULT_ARCHIVE_TIMEOUT_MS;
    this.archiveMaxEntries = options.archiveMaxEntries ?? DEFAULT_ARCHIVE_MAX_ENTRIES;
    this.archiveMaxInputBytes = options.archiveMaxInputBytes ?? DEFAULT_ARCHIVE_MAX_INPUT_BYTES;
    this.archiveMaxExtractBytes = options.archiveMaxExtractBytes ?? DEFAULT_ARCHIVE_MAX_EXTRACT_BYTES;
    this.convertTimeoutMs = options.convertTimeoutMs ?? DEFAULT_CONVERT_TIMEOUT_MS;
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
      case CREATE_FOLDER:
        return runCreateFolder(
          args,
          { getAllowedDirectories: this.getAllowedDirectories, getEnvironment: this.getEnvironment },
          { signal: options.signal },
        );
      case WRITE_FILE:
        return runWriteFile(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            drivers: this.writeDrivers,
          },
          { signal: options.signal },
        );
      case EDIT_FILE:
        return runEditFile(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            maxFileBytes: this.editMaxFileBytes,
          },
          { signal: options.signal },
        );
      case COPY_FILE:
        return runCopyFile(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            now: this.now,
            defaultTimeoutMs: this.copyTimeoutMs,
            maxEntries: this.copyMaxEntries,
            maxBytes: this.copyMaxBytes,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      case MOVE_FILE:
        return runMoveFile(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            now: this.now,
            defaultTimeoutMs: this.copyTimeoutMs,
            maxEntries: this.copyMaxEntries,
            maxBytes: this.copyMaxBytes,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      case DELETE_FILE:
        return runDeleteFile(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            platform: this.platform,
            trashHandler: this.trashHandler,
            defaultTimeoutMs: this.deleteTimeoutMs,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      case ARCHIVE_FILES:
        return runArchiveFiles(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            now: this.now,
            defaultTimeoutMs: this.archiveTimeoutMs,
            maxEntries: this.archiveMaxEntries,
            maxInputBytes: this.archiveMaxInputBytes,
            maxExtractBytes: this.archiveMaxExtractBytes,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      case CONVERT_FILE:
        return runConvertFile(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            driver: this.convertDriver,
            platform: this.platform,
            defaultTimeoutMs: this.convertTimeoutMs,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      default:
        return fail(`Unknown tool: '${name}'.`);
    }
  }
}
