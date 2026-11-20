/**
 * `jarvis_files`: herramienta `system_info`.
 *
 * Informa hardware, sistema operativo, discos, servicios o herramientas de desarrollo instaladas.
 * - CPU, memoria y SO salen del módulo `os` de Node (o de `SystemReader.readHost` en pruebas).
 * - Discos, servicios y GPU salen de PowerShell con consultas fijas que devuelven JSON (`ConvertTo-Json`),
 *   inyectables mediante `SystemReader` para poder probar sin Windows.
 * - Si un valor o subsección no se puede leer, figura como `unknown` con el motivo sin abortar el resto;
 *   solo devuelve `isError: true` si falla todo lo pedido.
 */

import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { BUDGET } from "../../core/budget.ts";
import { omissionMarker } from "../../core/text.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage, isRecord } from "../../core/utils.ts";
import { formatSize } from "../../core/tools/filePaths.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_SYSTEM_TIMEOUT_MS = 8_000;
export const DEFAULT_SERVICES_LIMIT = 100;
export const MAX_SERVICES_LIMIT = 500;

export const SYSTEM_SECTIONS = ["overview", "hardware", "os", "disks", "services", "dev_tools"] as const;
export type SystemSection = (typeof SYSTEM_SECTIONS)[number];

export const SERVICE_STATUS_FILTERS = ["running", "stopped", "all"] as const;
export type ServiceStatusFilter = (typeof SERVICE_STATUS_FILTERS)[number];

export const DEV_TOOLS_LIST = [
  "git",
  "node",
  "npm",
  "python",
  "pip",
  "java",
  "dotnet",
  "docker",
  "code",
  "go",
  "rustc",
  "cargo",
] as const;

export interface HostOsInfo {
  readonly cpuModel: string;
  readonly cores: number;
  readonly totalMemBytes: number;
  readonly osName: string;
  readonly osVersion: string;
  readonly osBuild: string;
  readonly arch: string;
  readonly uptimeSec: number;
  readonly user: string | { readonly status: "unknown"; readonly reason: string };
}

export interface DiskInfo {
  readonly letter: string;
  readonly label: string;
  readonly fileSystem: string;
  readonly sizeBytes: number;
  readonly freeBytes: number;
  readonly usedPercent: number;
}

export interface ServiceInfo {
  readonly name: string;
  readonly displayName: string;
  readonly status: string;
}

export interface DevToolInfo {
  readonly name: string;
  readonly installed: boolean | "unknown";
  readonly version?: string;
  readonly reason?: string;
}

export interface SystemReader {
  readHost(): HostOsInfo;
  readGpus(signal?: AbortSignal): Promise<readonly string[]>;
  readDisks(signal?: AbortSignal): Promise<readonly DiskInfo[]>;
  readServices(signal?: AbortSignal): Promise<readonly ServiceInfo[]>;
  readDevTools(tools: readonly string[], signal?: AbortSignal): Promise<readonly DevToolInfo[]>;
}

export interface SystemInfoDeps {
  readonly reader: SystemReader;
  readonly defaultTimeoutMs: number;
}

type UnknownValue = { readonly status: "unknown"; readonly reason: string };

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const unknownValue = (reason: string): UnknownValue => ({ status: "unknown", reason });

const PS_UTF8_PREFIX = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)";

const PS_GPUS_SCRIPT = [
  PS_UTF8_PREFIX,
  "@(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ Name = $_.Name } }) | ConvertTo-Json -Compress",
].join("; ");

const PS_DISKS_SCRIPT = [
  PS_UTF8_PREFIX,
  "@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [pscustomobject]@{ DeviceID = $_.DeviceID; VolumeName = $_.VolumeName; FileSystem = $_.FileSystem; Size = [double]$_.Size; FreeSpace = [double]$_.FreeSpace } }) | ConvertTo-Json -Compress",
].join("; ");

const PS_SERVICES_SCRIPT = [
  PS_UTF8_PREFIX,
  "@(Get-Service | ForEach-Object { [pscustomobject]@{ Name = $_.Name; DisplayName = $_.DisplayName; Status = $_.Status.ToString() } }) | ConvertTo-Json -Compress",
].join("; ");

async function runPowerShellJson(script: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown[]> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, signal },
  );
  const trimmed = stdout.trim();
  if (trimmed === "" || trimmed === "null") return [];
  const parsed: unknown = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function defaultReadHost(): HostOsInfo {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model?.trim() || "unknown";
  const release = os.release();
  const osVersion = typeof os.version === "function" ? os.version() : os.type();
  const buildParts = release.split(".");
  const osBuild = buildParts.length >= 3 ? buildParts[2] : release;
  let user: HostOsInfo["user"];
  try {
    user = os.userInfo().username;
  } catch (error) {
    user = unknownValue(errorMessage(error));
  }
  return {
    cpuModel,
    cores: cpus.length,
    totalMemBytes: os.totalmem(),
    osName: os.type() === "Windows_NT" ? "Windows" : os.type(),
    osVersion,
    osBuild,
    arch: os.arch(),
    uptimeSec: Math.floor(os.uptime()),
    user,
  };
}

function devToolArgs(tool: string): readonly string[] {
  if (tool === "java") return ["-version"];
  if (tool === "go") return ["version"];
  return ["--version"];
}

function firstLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "") ?? "";
}

async function probeDevTool(tool: string, timeoutMs: number, signal?: AbortSignal): Promise<DevToolInfo> {
  try {
    const { stdout, stderr } = await execFileAsync(tool, [...devToolArgs(tool)], {
      timeout: Math.min(timeoutMs, 3_000),
      windowsHide: true,
      signal,
    });
    const version = firstLine(`${stdout}\n${stderr}`);
    return { name: tool, installed: true, version: version || "installed" };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (err.code === "ENOENT") {
      return { name: tool, installed: false };
    }
    const output = firstLine(`${err.stdout ?? ""}\n${err.stderr ?? ""}`);
    if (err.code === undefined && output !== "") {
      return { name: tool, installed: true, version: output };
    }
    return { name: tool, installed: "unknown", reason: errorMessage(error) };
  }
}

export function createDefaultSystemReader(platform: NodeJS.Platform = process.platform, timeoutMs = DEFAULT_SYSTEM_TIMEOUT_MS): SystemReader {
  const requireWindows = (what: string): void => {
    if (platform !== "win32") {
      throw new Error(`${what} requires Windows PowerShell (current platform: ${platform}).`);
    }
  };

  return {
    readHost: defaultReadHost,
    async readGpus(signal?: AbortSignal): Promise<readonly string[]> {
      requireWindows("GPU information");
      const rows = await runPowerShellJson(PS_GPUS_SCRIPT, timeoutMs, signal);
      return rows
        .filter(isRecord)
        .map((r) => (typeof r.Name === "string" ? r.Name.trim() : ""))
        .filter((n) => n !== "");
    },
    async readDisks(signal?: AbortSignal): Promise<readonly DiskInfo[]> {
      requireWindows("Disk information");
      const rows = await runPowerShellJson(PS_DISKS_SCRIPT, timeoutMs, signal);
      const disks: DiskInfo[] = [];
      for (const r of rows) {
        if (!isRecord(r) || typeof r.DeviceID !== "string") continue;
        const sizeBytes = typeof r.Size === "number" && Number.isFinite(r.Size) ? r.Size : 0;
        const freeBytes = typeof r.FreeSpace === "number" && Number.isFinite(r.FreeSpace) ? r.FreeSpace : 0;
        const usedPercent = sizeBytes > 0 ? Math.round(((sizeBytes - freeBytes) / sizeBytes) * 1000) / 10 : 0;
        disks.push({
          letter: r.DeviceID.trim(),
          label: typeof r.VolumeName === "string" ? r.VolumeName.trim() : "",
          fileSystem: typeof r.FileSystem === "string" ? r.FileSystem.trim() : "unknown",
          sizeBytes,
          freeBytes,
          usedPercent,
        });
      }
      return disks;
    },
    async readServices(signal?: AbortSignal): Promise<readonly ServiceInfo[]> {
      requireWindows("Windows services list");
      const rows = await runPowerShellJson(PS_SERVICES_SCRIPT, timeoutMs, signal);
      const services: ServiceInfo[] = [];
      for (const r of rows) {
        if (!isRecord(r) || typeof r.Name !== "string") continue;
        services.push({
          name: r.Name.trim(),
          displayName: typeof r.DisplayName === "string" ? r.DisplayName.trim() : r.Name.trim(),
          status: typeof r.Status === "string" ? r.Status.trim() : "unknown",
        });
      }
      return services;
    },
    async readDevTools(tools: readonly string[], signal?: AbortSignal): Promise<readonly DevToolInfo[]> {
      return Promise.all(tools.map((tool) => probeDevTool(tool, timeoutMs, signal)));
    },
  };
}

interface ParsedSystemArgs {
  readonly section: SystemSection;
  readonly status: ServiceStatusFilter;
  readonly limit: number;
}

function parseArgs(raw: Record<string, unknown>): { readonly ok: true; readonly args: ParsedSystemArgs } | { readonly ok: false; readonly message: string } {
  if (typeof raw.section !== "string" || !(SYSTEM_SECTIONS as readonly string[]).includes(raw.section)) {
    return { ok: false, message: `'section' is required and must be one of: ${SYSTEM_SECTIONS.join(", ")}.` };
  }

  let status: ServiceStatusFilter = "running";
  if (raw.status !== undefined && raw.status !== null) {
    if (typeof raw.status !== "string" || !(SERVICE_STATUS_FILTERS as readonly string[]).includes(raw.status)) {
      return { ok: false, message: `'status' must be one of: ${SERVICE_STATUS_FILTERS.join(", ")}.` };
    }
    status = raw.status as ServiceStatusFilter;
  }

  let limit = DEFAULT_SERVICES_LIMIT;
  if (raw.limit !== undefined && raw.limit !== null) {
    if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1) {
      return { ok: false, message: `'limit' must be a positive integer (max ${MAX_SERVICES_LIMIT}).` };
    }
    limit = Math.min(raw.limit, MAX_SERVICES_LIMIT);
  }

  return { ok: true, args: { section: raw.section as SystemSection, status, limit } };
}

function formatUptime(sec: number): string {
  const days = Math.floor(sec / 86_400);
  const hours = Math.floor((sec % 86_400) / 3_600);
  const mins = Math.floor((sec % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatDiskLine(d: DiskInfo): string {
  const label = d.label !== "" ? ` (${d.label})` : "";
  return `${d.letter}${label} [${d.fileSystem}] ${formatSize(d.freeBytes)} free / ${formatSize(d.sizeBytes)} (${d.usedPercent}% used)`;
}

function fitToSummary(header: string, lines: readonly string[]): { readonly shown: readonly string[]; readonly truncated: boolean } {
  const maxBody = Math.max(BUDGET.summaryMax - Math.max(header.length + 1, 160), 200);
  const shown: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.length + (shown.length > 0 ? 1 : 0);
    if (shown.length > 0 && used + cost > maxBody) break;
    shown.push(line);
    used += cost;
  }
  return { shown, truncated: shown.length < lines.length };
}

export async function runSystemInfo(
  rawArgs: Record<string, unknown>,
  deps: SystemInfoDeps,
  options: { readonly signal?: AbortSignal } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) {
    return toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", sections: {} } });
  }

  const parsed = parseArgs(rawArgs);
  if (!parsed.ok) return fail(parsed.message);
  const { section, status, limit } = parsed.args;
  const reader = deps.reader;

  const readHostSafe = (): { readonly ok: true; readonly host: HostOsInfo } | { readonly ok: false; readonly reason: string } => {
    try {
      return { ok: true, host: reader.readHost() };
    } catch (error) {
      return { ok: false, reason: errorMessage(error) };
    }
  };

  const readGpusSafe = async (): Promise<{ readonly ok: true; readonly gpus: readonly string[] } | { readonly ok: false; readonly reason: string }> => {
    try {
      return { ok: true, gpus: await reader.readGpus(options.signal) };
    } catch (error) {
      return { ok: false, reason: errorMessage(error) };
    }
  };

  const readDisksSafe = async (): Promise<{ readonly ok: true; readonly disks: readonly DiskInfo[] } | { readonly ok: false; readonly reason: string }> => {
    try {
      return { ok: true, disks: await reader.readDisks(options.signal) };
    } catch (error) {
      return { ok: false, reason: errorMessage(error) };
    }
  };

  const buildHardware = async () => {
    const [hostRes, gpusRes] = [readHostSafe(), await readGpusSafe()];
    if (!hostRes.ok && !gpusRes.ok) {
      return { ok: false as const, reason: hostRes.reason };
    }
    const gpusValue = gpusRes.ok ? gpusRes.gpus : unknownValue(gpusRes.reason);
    const gpuText = gpusRes.ok
      ? gpusRes.gpus.length > 0
        ? gpusRes.gpus.join(", ")
        : "none detected"
      : `unknown (${gpusRes.reason})`;

    if (!hostRes.ok) {
      return {
        ok: true as const,
        data: { cpuModel: unknownValue(hostRes.reason), cores: unknownValue(hostRes.reason), totalMemBytes: unknownValue(hostRes.reason), gpus: gpusValue },
        lines: [`CPU: unknown (${hostRes.reason})`, `RAM: unknown (${hostRes.reason})`, `GPU: ${gpuText}`],
      };
    }

    const h = hostRes.host;
    return {
      ok: true as const,
      data: {
        cpuModel: h.cpuModel,
        cores: h.cores,
        totalMemBytes: h.totalMemBytes,
        gpus: gpusValue,
      },
      lines: [
        `CPU: ${h.cpuModel} (${h.cores} cores)`,
        `RAM: ${formatSize(h.totalMemBytes)}`,
        `GPU: ${gpuText}`,
      ],
    };
  };

  const buildOs = () => {
    const hostRes = readHostSafe();
    if (!hostRes.ok) return { ok: false as const, reason: hostRes.reason };
    const h = hostRes.host;
    const userText = typeof h.user === "string" ? h.user : `unknown (${h.user.reason})`;
    return {
      ok: true as const,
      data: {
        name: h.osName,
        version: h.osVersion,
        build: h.osBuild,
        arch: h.arch,
        uptimeSec: h.uptimeSec,
        user: h.user,
      },
      lines: [
        `OS: ${h.osName} ${h.osVersion} (build ${h.osBuild}, ${h.arch})`,
        `Uptime: ${formatUptime(h.uptimeSec)}`,
        `User: ${userText}`,
      ],
    };
  };

  if (section === "hardware") {
    const hw = await buildHardware();
    if (options.signal?.aborted) return toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", sections: {} } });
    if (!hw.ok) return fail(`Could not read hardware info: ${hw.reason}`);
    const text = ["status: ok · section: hardware", ...hw.lines].join("\n");
    return toolResult({ text, raw: text, data: { state: "ok", truncated: false, sections: { hardware: hw.data } } });
  }

  if (section === "os") {
    const osSec = buildOs();
    if (!osSec.ok) return fail(`Could not read OS info: ${osSec.reason}`);
    const text = ["status: ok · section: os", ...osSec.lines].join("\n");
    return toolResult({ text, raw: text, data: { state: "ok", truncated: false, sections: { os: osSec.data } } });
  }

  if (section === "disks") {
    const disksRes = await readDisksSafe();
    if (options.signal?.aborted) return toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", sections: {} } });
    if (!disksRes.ok) return fail(`Could not read disk info: ${disksRes.reason}`);
    const lines = disksRes.disks.length === 0 ? ["No fixed disks detected."] : disksRes.disks.map(formatDiskLine);
    const header = `status: ok · section: disks (${disksRes.disks.length})`;
    const fitted = fitToSummary(header, lines);
    const text = [header, ...fitted.shown, ...(fitted.truncated ? [omissionMarker(lines.length - fitted.shown.length, "discos")] : [])].join("\n");
    const raw = [header, ...lines].join("\n");
    return toolResult({
      text,
      raw,
      data: { state: "ok", truncated: fitted.truncated, sections: { disks: disksRes.disks } },
    });
  }

  if (section === "overview") {
    const [hw, osSec, disksRes] = await Promise.all([buildHardware(), Promise.resolve(buildOs()), readDisksSafe()]);
    if (options.signal?.aborted) return toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", sections: {} } });

    if (!hw.ok && !osSec.ok && !disksRes.ok) {
      return fail(`Could not read system overview: ${hw.reason}; ${osSec.reason}; ${disksRes.reason}`);
    }

    const hwData = hw.ok ? hw.data : unknownValue(hw.reason);
    const osData = osSec.ok ? osSec.data : unknownValue(osSec.reason);
    const disksData = disksRes.ok ? disksRes.disks : unknownValue(disksRes.reason);

    const lines: string[] = [
      "status: ok · section: overview",
      ...(hw.ok ? hw.lines : [`Hardware: unknown (${hw.reason})`]),
      ...(osSec.ok ? osSec.lines : [`OS: unknown (${osSec.reason})`]),
      ...(disksRes.ok
        ? disksRes.disks.length === 0
          ? ["Disks: none detected"]
          : ["Disks:", ...disksRes.disks.map((d) => `  ${formatDiskLine(d)}`)]
        : [`Disks: unknown (${disksRes.reason})`]),
    ];
    const text = lines.join("\n");
    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        truncated: false,
        sections: { hardware: hwData, os: osData, disks: disksData },
      },
    });
  }

  if (section === "services") {
    let allServices: readonly ServiceInfo[];
    try {
      allServices = await reader.readServices(options.signal);
    } catch (error) {
      if (options.signal?.aborted) return toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", sections: {} } });
      return fail(`Could not read services: ${errorMessage(error)}`);
    }
    if (options.signal?.aborted) return toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", sections: {} } });

    const filtered = allServices
      .filter((s) => status === "all" || s.status.toLowerCase() === status)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const limited = filtered.slice(0, limit);
    const lines = limited.map((s) => `[${s.status}] ${s.name} — ${s.displayName}`);
    const prelimHeader = `status: ok · section: services (${status}) · showing ${limited.length} of ${filtered.length}`;
    const fitted = fitToSummary(prelimHeader, lines);
    const shownCount = fitted.shown.length;
    const truncated = shownCount < filtered.length;
    const header =
      shownCount === filtered.length
        ? `status: ok · section: services (${status}) · ${filtered.length} service${filtered.length === 1 ? "" : "s"}`
        : `status: ok · section: services (${status}) · showing ${shownCount} of ${filtered.length}`;

    const text = [
      header,
      ...(lines.length === 0 ? ["No matching services."] : fitted.shown),
      ...(lines.length > shownCount ? [omissionMarker(lines.length - shownCount, "servicios")] : []),
    ].join("\n");
    const rawHeader = `status: ok · section: services (${status}) · ${filtered.length} service${filtered.length === 1 ? "" : "s"}`;
    const raw = [rawHeader, ...(filtered.length === 0 ? ["No matching services."] : filtered.map((s) => `[${s.status}] ${s.name} — ${s.displayName}`))].join("\n");

    return toolResult({
      text,
      raw,
      data: {
        state: "ok",
        truncated,
        sections: {
          services: {
            filter: status,
            total: filtered.length,
            shown: shownCount,
            items: limited,
          },
        },
      },
    });
  }

  // section === "dev_tools"
  let toolsInfo: readonly DevToolInfo[];
  try {
    toolsInfo = await reader.readDevTools(DEV_TOOLS_LIST, options.signal);
  } catch (error) {
    if (options.signal?.aborted) return toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", sections: {} } });
    return fail(`Could not check dev tools: ${errorMessage(error)}`);
  }
  if (options.signal?.aborted) return toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", sections: {} } });

  const lines = toolsInfo.map((t) => {
    if (t.installed === true) return `[installed] ${t.name}: ${t.version ?? "yes"}`;
    if (t.installed === false) return `[missing]   ${t.name}`;
    return `[unknown]   ${t.name}: ${t.reason ?? "unreadable"}`;
  });
  const installedCount = toolsInfo.filter((t) => t.installed === true).length;
  const header = `status: ok · section: dev_tools (${installedCount}/${toolsInfo.length} installed)`;
  const text = [header, ...lines].join("\n");

  return toolResult({
    text,
    raw: text,
    data: {
      state: "ok",
      truncated: false,
      sections: { dev_tools: toolsInfo },
    },
  });
}
