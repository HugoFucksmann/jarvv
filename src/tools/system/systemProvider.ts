/**
 * Proveedor nativo `jarvis_system`:
 * `system_info`, `stop_process`, `pc_settings`, `power`, `open_on_screen`, `clipboard`.
 *
 * Aislado de los demás grupos en `src/tools/` y sin integración aún a D1/D2.
 * Todas las dependencias externas se inyectan por opciones para pruebas deterministas sin GUI ni Windows.
 */

import { getUserEnvironment, type UserEnvironment } from "../../core/environment.ts";
import { effectiveTimeoutMs } from "../../core/tools/filePaths.ts";
import type { ToolCallOptions, ToolProvider } from "../../core/tools/provider.ts";
import { toolFail as fail } from "../../core/tools/result.ts";
import type { MCPCallResult, MCPTool } from "../../core/types.ts";
import { DEFAULT_CLIPBOARD_TIMEOUT_MS, runClipboard, type ClipboardDriver } from "./clipboard.ts";
import { DEFAULT_OPEN_TIMEOUT_MS, runOpenOnScreen, type ScreenOpener } from "./openOnScreen.ts";
import {
  DEFAULT_PC_SETTINGS_TIMEOUT_MS,
  PC_SETTINGS,
  PC_SETTING_ACTIONS,
  runPcSettings,
  type PcSettingsDriver,
} from "./pcSettings.ts";
import { DEFAULT_POWER_TIMEOUT_MS, MAX_POWER_DELAY_SEC, POWER_ACTIONS, runPower, type PowerController } from "./power.ts";
import { DEFAULT_STOP_PROCESS_TIMEOUT_MS, runStopProcess, type ProcessKiller } from "./stopProcess.ts";
import {
  createDefaultSystemReader,
  DEFAULT_ITEMS_LIMIT,
  DEFAULT_SYSTEM_TIMEOUT_MS,
  MAX_ITEMS_LIMIT,
  PORT_PROTOCOLS,
  PROCESS_SORT_FIELDS,
  runSystemInfo,
  SERVICE_STATUS_FILTERS,
  SYSTEM_SECTIONS,
  type SystemReader,
} from "./systemInfo.ts";

const SYSTEM_SERVER = "jarvis_system";
const SYSTEM_INFO = "system_info";
const STOP_PROCESS = "stop_process";
const PC_SETTINGS_TOOL_NAME = "pc_settings";
const POWER_TOOL_NAME = "power";
const OPEN_ON_SCREEN = "open_on_screen";
const CLIPBOARD = "clipboard";

export type { ClipboardDriver } from "./clipboard.ts";
export type { OpenTargetType, ResolvedOpenKind, ScreenOpener } from "./openOnScreen.ts";
export type { PcSettingAction, PcSettingName, PcSettingsDriver, SettingValue } from "./pcSettings.ts";
export type { PowerAction, PowerController, PowerRequest } from "./power.ts";
export type { ProcessKiller, StoppedProcessItem } from "./stopProcess.ts";
export type {
  DateTimeInfo,
  DevToolInfo,
  DiskInfo,
  HostOsInfo,
  NetworkInfo,
  NetworkInterfaceSummary,
  PortInfo,
  ProcessInfo,
  ServiceInfo,
  SystemReader,
} from "./systemInfo.ts";

const SYSTEM_INFO_TOOL: MCPTool = {
  name: SYSTEM_INFO,
  description:
    "Inspect hardware, OS, disks, services, dev tools, network, running processes, listening ports, or date/time.",
  inputSchema: {
    type: "object",
    properties: {
      section: {
        type: "string",
        enum: [...SYSTEM_SECTIONS],
        description: "Section to inspect.",
      },
      status: {
        type: "string",
        enum: [...SERVICE_STATUS_FILTERS],
        description: "For 'services': filter by 'running' (default), 'stopped', or 'all'.",
      },
      sortBy: {
        type: "string",
        enum: [...PROCESS_SORT_FIELDS],
        description: "For 'processes': sort by 'memory' (default), 'cpu', or 'name'.",
      },
      protocol: {
        type: "string",
        enum: [...PORT_PROTOCOLS],
        description: "For 'ports': 'all' (default), 'tcp', or 'udp'.",
      },
      nameFilter: {
        type: "string",
        description: "Optional case-insensitive substring filter for services, processes, or ports.",
      },
      limit: {
        type: "integer",
        description: `Maximum items for list sections (default ${DEFAULT_ITEMS_LIMIT}, max ${MAX_ITEMS_LIMIT}).`,
      },
    },
    required: ["section"],
    additionalProperties: false,
  },
};

const STOP_PROCESS_TOOL: MCPTool = {
  name: STOP_PROCESS,
  description: "Stop a running process by PID or process name (blocks critical OS and self processes).",
  inputSchema: {
    type: "object",
    properties: {
      pid: { type: "integer", description: "Process ID to stop (provide pid or name)." },
      name: { type: "string", description: "Process name to stop, e.g. 'notepad' (provide pid or name)." },
      force: { type: "boolean", description: "Force termination (default false)." },
    },
    additionalProperties: false,
  },
};

const PC_SETTINGS_TOOL: MCPTool = {
  name: PC_SETTINGS_TOOL_NAME,
  description: "Get or set PC settings: brightness (0..100), wifi, bluetooth, dark_mode, do_not_disturb.",
  inputSchema: {
    type: "object",
    properties: {
      setting: { type: "string", enum: [...PC_SETTINGS], description: "Setting to read or update." },
      action: { type: "string", enum: [...PC_SETTING_ACTIONS], description: "'get' or 'set'." },
      value: {
        type: ["integer", "string", "boolean"],
        description: "For 'set': 0..100 for brightness, or 'on'/'off' (true/false) for toggles.",
      },
    },
    required: ["setting", "action"],
    additionalProperties: false,
  },
};

const POWER_TOOL: MCPTool = {
  name: POWER_TOOL_NAME,
  description: "Execute PC power action: lock, sleep, restart, or shutdown.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...POWER_ACTIONS], description: "Power action to run." },
      delaySec: {
        type: "integer",
        description: `Optional delay in seconds for restart/shutdown (0..${MAX_POWER_DELAY_SEC}, default 0).`,
      },
      force: { type: "boolean", description: "Force close apps on restart/shutdown (default false)." },
    },
    required: ["action"],
    additionalProperties: false,
  },
};

const OPEN_ON_SCREEN_TOOL: MCPTool = {
  name: OPEN_ON_SCREEN,
  description: "Open an application, http(s) URL, or local path on the user's screen (does not return file content).",
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: "Application name (e.g. 'notepad'), http(s) URL, or local path/alias (home, desktop, documents, downloads).",
      },
      type: {
        type: "string",
        enum: ["auto", "app", "url", "path"],
        description: "Optional target type hint (default 'auto').",
      },
    },
    required: ["target"],
    additionalProperties: false,
  },
};

const CLIPBOARD_TOOL: MCPTool = {
  name: CLIPBOARD,
  description: "Read or write text in the system clipboard.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["read", "write"],
        description: "Operation: 'read' or 'write'.",
      },
      text: {
        type: "string",
        description: "Text to write into the clipboard (required when action is 'write').",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
};

const TOOLS: readonly MCPTool[] = [
  SYSTEM_INFO_TOOL,
  STOP_PROCESS_TOOL,
  PC_SETTINGS_TOOL,
  POWER_TOOL,
  OPEN_ON_SCREEN_TOOL,
  CLIPBOARD_TOOL,
];

interface SystemProviderOptions {
  readonly allowedDirectories?: () => readonly string[];
  readonly environment?: () => Promise<UserEnvironment>;
  readonly platform?: NodeJS.Platform;
  readonly systemReader?: Partial<SystemReader>;
  readonly processKiller?: ProcessKiller;
  readonly pcSettingsDriver?: PcSettingsDriver;
  readonly powerController?: PowerController;
  readonly screenOpener?: ScreenOpener;
  readonly clipboardDriver?: ClipboardDriver;
  readonly systemTimeoutMs?: number;
  readonly stopProcessTimeoutMs?: number;
  readonly pcSettingsTimeoutMs?: number;
  readonly powerTimeoutMs?: number;
  readonly openTimeoutMs?: number;
  readonly clipboardTimeoutMs?: number;
  readonly selfPid?: number;
  readonly parentPid?: number;
}

export class SystemProvider implements ToolProvider {
  readonly name = SYSTEM_SERVER;
  readonly version = "1.0.0";

  private readonly getAllowedDirectories: () => readonly string[];
  private readonly getEnvironment: () => Promise<UserEnvironment>;
  private readonly platform: NodeJS.Platform;
  private readonly customReader: Partial<SystemReader> | undefined;
  private readonly defaultReader: SystemReader;
  private readonly processKiller: ProcessKiller | undefined;
  private readonly pcSettingsDriver: PcSettingsDriver | undefined;
  private readonly powerController: PowerController | undefined;
  private readonly screenOpener: ScreenOpener | undefined;
  private readonly clipboardDriver: ClipboardDriver | undefined;
  private readonly systemTimeoutMs: number;
  private readonly stopProcessTimeoutMs: number;
  private readonly pcSettingsTimeoutMs: number;
  private readonly powerTimeoutMs: number;
  private readonly openTimeoutMs: number;
  private readonly clipboardTimeoutMs: number;
  private readonly selfPid: number | undefined;
  private readonly parentPid: number | undefined;

  constructor(options: SystemProviderOptions = {}) {
    this.getAllowedDirectories = options.allowedDirectories ?? (() => []);
    this.getEnvironment = options.environment ?? getUserEnvironment;
    this.platform = options.platform ?? process.platform;
    this.systemTimeoutMs = options.systemTimeoutMs ?? DEFAULT_SYSTEM_TIMEOUT_MS;
    this.stopProcessTimeoutMs = options.stopProcessTimeoutMs ?? DEFAULT_STOP_PROCESS_TIMEOUT_MS;
    this.pcSettingsTimeoutMs = options.pcSettingsTimeoutMs ?? DEFAULT_PC_SETTINGS_TIMEOUT_MS;
    this.powerTimeoutMs = options.powerTimeoutMs ?? DEFAULT_POWER_TIMEOUT_MS;
    this.openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    this.clipboardTimeoutMs = options.clipboardTimeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS;

    this.customReader = options.systemReader;
    this.defaultReader = this.buildReader(this.systemTimeoutMs);

    this.processKiller = options.processKiller;
    this.pcSettingsDriver = options.pcSettingsDriver;
    this.powerController = options.powerController;
    this.screenOpener = options.screenOpener;
    this.clipboardDriver = options.clipboardDriver;
    this.selfPid = options.selfPid;
    this.parentPid = options.parentPid;
  }

  private buildReader(timeoutMs: number): SystemReader {
    const defaults = createDefaultSystemReader(this.platform, timeoutMs);
    return {
      readHost: this.customReader?.readHost ?? defaults.readHost,
      readGpus: this.customReader?.readGpus ?? defaults.readGpus,
      readDisks: this.customReader?.readDisks ?? defaults.readDisks,
      readServices: this.customReader?.readServices ?? defaults.readServices,
      readDevTools: this.customReader?.readDevTools ?? defaults.readDevTools,
      readNetwork: this.customReader?.readNetwork ?? defaults.readNetwork,
      readProcesses: this.customReader?.readProcesses ?? defaults.readProcesses,
      readPorts: this.customReader?.readPorts ?? defaults.readPorts,
      readDateTime: this.customReader?.readDateTime ?? defaults.readDateTime,
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
      case SYSTEM_INFO: {
        const limitMs = effectiveTimeoutMs(this.systemTimeoutMs, options.timeoutMs);
        const reader = limitMs === this.systemTimeoutMs ? this.defaultReader : this.buildReader(limitMs);
        return runSystemInfo(args, { reader }, { signal: options.signal });
      }
      case STOP_PROCESS:
        return runStopProcess(
          args,
          {
            killer: this.processKiller,
            platform: this.platform,
            defaultTimeoutMs: this.stopProcessTimeoutMs,
            selfPid: this.selfPid,
            parentPid: this.parentPid,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      case PC_SETTINGS_TOOL_NAME:
        return runPcSettings(
          args,
          {
            driver: this.pcSettingsDriver,
            platform: this.platform,
            defaultTimeoutMs: this.pcSettingsTimeoutMs,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      case POWER_TOOL_NAME:
        return runPower(
          args,
          {
            controller: this.powerController,
            platform: this.platform,
            defaultTimeoutMs: this.powerTimeoutMs,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      case OPEN_ON_SCREEN:
        return runOpenOnScreen(
          args,
          {
            getAllowedDirectories: this.getAllowedDirectories,
            getEnvironment: this.getEnvironment,
            opener: this.screenOpener,
            platform: this.platform,
            defaultTimeoutMs: this.openTimeoutMs,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      case CLIPBOARD:
        return runClipboard(
          args,
          {
            driver: this.clipboardDriver,
            platform: this.platform,
            defaultTimeoutMs: this.clipboardTimeoutMs,
          },
          { signal: options.signal, timeoutMs: options.timeoutMs },
        );
      default:
        return fail(`Unknown tool: '${name}'.`);
    }
  }
}
