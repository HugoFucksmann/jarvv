/**
 * `jarvis_system`: herramienta `system_info` (completa según `DISENO_TOOLS_NATIVAS.md`).
 *
 * Cubre las 10 secciones del diseño para el grupo `system`:
 * - Clásicas: `overview`, `hardware`, `os`, `disks`, `services`, `dev_tools`.
 * - Nuevas del grupo `system`: `network`, `processes`, `ports`, `datetime`.
 *
 * Completamente aislada de `src/tools/files/` (sin importaciones cruzadas) y totalmente
 * inyectable mediante `SystemReader` para pruebas deterministas sin Windows.
 */

import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { BUDGET } from "../../core/budget.ts";
import { omissionMarker } from "../../core/text.ts";
import { fitLinesToBudget, formatSize } from "../../core/tools/filePaths.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage, isRecord } from "../../core/utils.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_SYSTEM_TIMEOUT_MS = 8_000;
export const DEFAULT_ITEMS_LIMIT = 50;
export const MAX_ITEMS_LIMIT = 500;

export const SYSTEM_SECTIONS = [
  "overview",
  "hardware",
  "os",
  "disks",
  "services",
  "dev_tools",
  "network",
  "processes",
  "ports",
  "datetime",
] as const;
export type SystemSection = (typeof SYSTEM_SECTIONS)[number];

export const SERVICE_STATUS_FILTERS = ["running", "stopped", "all"] as const;
export type ServiceStatusFilter = (typeof SERVICE_STATUS_FILTERS)[number];

export const PROCESS_SORT_FIELDS = ["cpu", "memory", "name"] as const;
export type ProcessSortField = (typeof PROCESS_SORT_FIELDS)[number];

export const PORT_PROTOCOLS = ["all", "tcp", "udp"] as const;
export type PortProtocolFilter = (typeof PORT_PROTOCOLS)[number];

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
  readonly freeMemBytes: number;
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

export interface NetworkInterfaceSummary {
  readonly name: string;
  readonly addresses: readonly string[];
  readonly internal: boolean;
  readonly mac?: string;
}

export interface NetworkInfo {
  readonly hostname: string;
  readonly interfaces: readonly NetworkInterfaceSummary[];
  readonly defaultGateway?: string;
  readonly dnsServers?: readonly string[];
  readonly wifiSsid?: string;
}

export interface ProcessInfo {
  readonly pid: number;
  readonly name: string;
  readonly cpuSec: number;
  readonly memoryBytes: number;
  readonly windowTitle?: string;
}

export interface PortInfo {
  readonly protocol: "tcp" | "udp";
  readonly localAddress: string;
  readonly localPort: number;
  readonly state?: string;
  readonly pid: number;
  readonly processName?: string;
}

export interface DateTimeInfo {
  readonly iso: string;
  readonly localDateTime: string;
  readonly timeZone: string;
  readonly utcOffsetMinutes: number;
  readonly unixMs: number;
}

export interface SystemReader {
  readHost(): HostOsInfo;
  readGpus(signal?: AbortSignal): Promise<readonly string[]>;
  readDisks(signal?: AbortSignal): Promise<readonly DiskInfo[]>;
  readServices(signal?: AbortSignal): Promise<readonly ServiceInfo[]>;
  readDevTools(tools: readonly string[], signal?: AbortSignal): Promise<readonly DevToolInfo[]>;
  readNetwork(signal?: AbortSignal): Promise<NetworkInfo>;
  readProcesses(signal?: AbortSignal): Promise<readonly ProcessInfo[]>;
  readPorts(signal?: AbortSignal): Promise<readonly PortInfo[]>;
  readDateTime(): DateTimeInfo;
}

/** El plazo de las lecturas ya viene en el lector (`createDefaultSystemReader`): no hace falta repetirlo acá. */
export interface SystemInfoDeps {
  readonly reader: SystemReader;
}

type UnknownValue = { readonly status: "unknown"; readonly reason: string };

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", sections: {} } });

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

const PS_PROCESSES_SCRIPT = [
  PS_UTF8_PREFIX,
  "@(Get-Process | ForEach-Object { [pscustomobject]@{ Pid = $_.Id; Name = $_.ProcessName; Cpu = if ($null -ne $_.CPU) { [double]$_.CPU } else { 0.0 }; Mem = [double]$_.WorkingSet64; Title = $_.MainWindowTitle } }) | ConvertTo-Json -Compress",
].join("; ");

const PS_PORTS_SCRIPT = [
  PS_UTF8_PREFIX,
  "$names = @{}; Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $names[[int]$_.Id] = $_.ProcessName }",
  "$tcp = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Proto = 'tcp'; Addr = $_.LocalAddress; Port = [int]$_.LocalPort; State = $_.State.ToString(); Pid = [int]$_.OwningProcess; Proc = $names[[int]$_.OwningProcess] } })",
  "$udp = @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Proto = 'udp'; Addr = $_.LocalAddress; Port = [int]$_.LocalPort; State = 'Open'; Pid = [int]$_.OwningProcess; Proc = $names[[int]$_.OwningProcess] } })",
  "@($tcp + $udp) | ConvertTo-Json -Compress",
].join("; ");

const PS_NET_EXTRA_SCRIPT = [
  PS_UTF8_PREFIX,
  "$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop",
  "$dns = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.ServerAddresses } | Select-Object -Unique)",
  "[pscustomobject]@{ Gateway = $gw; Dns = $dns } | ConvertTo-Json -Compress",
].join("; ");

async function runPowerShellJson(script: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown[]> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 6 * 1024 * 1024, signal },
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
    freeMemBytes: os.freemem(),
    osName: os.type() === "Windows_NT" ? "Windows" : os.type(),
    osVersion,
    osBuild,
    arch: os.arch(),
    uptimeSec: Math.floor(os.uptime()),
    user,
  };
}

function defaultReadDateTime(): DateTimeInfo {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  return {
    iso: now.toISOString(),
    localDateTime: `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`,
    timeZone,
    utcOffsetMinutes: -now.getTimezoneOffset(),
    unixMs: now.getTime(),
  };
}

function collectNodeNetworkInterfaces(): NetworkInterfaceSummary[] {
  const raw = os.networkInterfaces();
  const list: NetworkInterfaceSummary[] = [];
  for (const [name, addrs] of Object.entries(raw)) {
    if (!addrs || addrs.length === 0) continue;
    const ips = addrs.map((a) => a.address);
    const internal = addrs.every((a) => a.internal);
    const mac = addrs.find((a) => a.mac && a.mac !== "00:00:00:00:00:00")?.mac;
    list.push({ name, addresses: ips, internal, ...(mac ? { mac } : {}) });
  }
  return list;
}

function firstLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "") ?? "";
}

async function probeDevTool(tool: string, timeoutMs: number, signal?: AbortSignal): Promise<DevToolInfo> {
  const args = tool === "java" ? ["-version"] : tool === "go" ? ["version"] : ["--version"];
  // En Windows npm/code son `.cmd`: Node no los ejecuta sin shell, así que se pasan por cmd.exe (nombre y argumentos fijos, sin entrada del usuario).
  const viaCmd = process.platform === "win32" && (tool === "npm" || tool === "code");
  try {
    const { stdout, stderr } = await execFileAsync(viaCmd ? "cmd.exe" : tool, viaCmd ? ["/d", "/s", "/c", `${tool} ${args.join(" ")}`] : args, {
      timeout: Math.min(timeoutMs, 3_000),
      windowsHide: true,
      signal,
    });
    const version = firstLine(`${stdout}\n${stderr}`);
    return { name: tool, installed: true, version: version || "installed" };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (err.code === "ENOENT") return { name: tool, installed: false };
    // Vía cmd.exe, un programa que no está en el PATH no da ENOENT sino exit 1 con "no se reconoce / is not recognized".
    if (viaCmd && /is not recognized|no se reconoce/i.test(`${err.stdout ?? ""}
${err.stderr ?? ""}`)) return { name: tool, installed: false };
    const output = firstLine(`${err.stdout ?? ""}\n${err.stderr ?? ""}`);
    if (err.code === undefined && output !== "") return { name: tool, installed: true, version: output };
    return { name: tool, installed: "unknown", reason: errorMessage(error) };
  }
}

export function createDefaultSystemReader(
  platform: NodeJS.Platform = process.platform,
  timeoutMs = DEFAULT_SYSTEM_TIMEOUT_MS,
): SystemReader {
  const requireWindows = (what: string): void => {
    if (platform !== "win32") {
      throw new Error(`${what} requires Windows PowerShell (current platform: ${platform}).`);
    }
  };

  return {
    readHost: defaultReadHost,
    readDateTime: defaultReadDateTime,
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
    async readNetwork(signal?: AbortSignal): Promise<NetworkInfo> {
      const interfaces = collectNodeNetworkInterfaces();
      let defaultGateway: string | undefined;
      let dnsServers: string[] | undefined;

      if (platform === "win32") {
        try {
          const rows = await runPowerShellJson(PS_NET_EXTRA_SCRIPT, timeoutMs, signal);
          const first = rows[0];
          if (isRecord(first)) {
            if (typeof first.Gateway === "string" && first.Gateway.trim() !== "") {
              defaultGateway = first.Gateway.trim();
            }
            if (Array.isArray(first.Dns)) {
              dnsServers = first.Dns.filter((v): v is string => typeof v === "string" && v.trim() !== "");
            }
          }
        } catch {
          // Conserva la información base de Node aunque fallen extras
        }
      }

      return {
        hostname: os.hostname(),
        interfaces,
        ...(defaultGateway ? { defaultGateway } : {}),
        ...(dnsServers && dnsServers.length > 0 ? { dnsServers } : {}),
      };
    },
    async readProcesses(signal?: AbortSignal): Promise<readonly ProcessInfo[]> {
      requireWindows("Process listing");
      const rows = await runPowerShellJson(PS_PROCESSES_SCRIPT, timeoutMs, signal);
      const list: ProcessInfo[] = [];
      for (const r of rows) {
        if (!isRecord(r) || typeof r.Pid !== "number" || typeof r.Name !== "string") continue;
        list.push({
          pid: r.Pid,
          name: r.Name.trim(),
          cpuSec: typeof r.Cpu === "number" && Number.isFinite(r.Cpu) ? r.Cpu : 0,
          memoryBytes: typeof r.Mem === "number" && Number.isFinite(r.Mem) ? r.Mem : 0,
          ...(typeof r.Title === "string" && r.Title.trim() !== "" ? { windowTitle: r.Title.trim() } : {}),
        });
      }
      return list;
    },
    async readPorts(signal?: AbortSignal): Promise<readonly PortInfo[]> {
      requireWindows("Listening ports inspection");
      const rows = await runPowerShellJson(PS_PORTS_SCRIPT, timeoutMs, signal);
      const list: PortInfo[] = [];
      for (const r of rows) {
        if (!isRecord(r) || typeof r.Port !== "number") continue;
        const protocol = r.Proto === "udp" ? "udp" : "tcp";
        list.push({
          protocol,
          localAddress: typeof r.Addr === "string" ? r.Addr : "0.0.0.0",
          localPort: r.Port,
          ...(typeof r.State === "string" ? { state: r.State } : {}),
          pid: typeof r.Pid === "number" ? r.Pid : 0,
          ...(typeof r.Proc === "string" && r.Proc.trim() !== "" ? { processName: r.Proc.trim() } : {}),
        });
      }
      return list;
    },
  };
}

interface ParsedSystemArgs {
  readonly section: SystemSection;
  readonly status: ServiceStatusFilter;
  readonly sortBy: ProcessSortField;
  readonly protocol: PortProtocolFilter;
  readonly nameFilter?: string;
  readonly limit: number;
}

function parseArgs(
  raw: Record<string, unknown>,
): { readonly ok: true; readonly args: ParsedSystemArgs } | { readonly ok: false; readonly message: string } {
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

  let sortBy: ProcessSortField = "memory";
  if (raw.sortBy !== undefined && raw.sortBy !== null) {
    if (typeof raw.sortBy !== "string" || !(PROCESS_SORT_FIELDS as readonly string[]).includes(raw.sortBy)) {
      return { ok: false, message: `'sortBy' must be one of: ${PROCESS_SORT_FIELDS.join(", ")}.` };
    }
    sortBy = raw.sortBy as ProcessSortField;
  }

  let protocol: PortProtocolFilter = "all";
  if (raw.protocol !== undefined && raw.protocol !== null) {
    if (typeof raw.protocol !== "string" || !(PORT_PROTOCOLS as readonly string[]).includes(raw.protocol)) {
      return { ok: false, message: `'protocol' must be one of: ${PORT_PROTOCOLS.join(", ")}.` };
    }
    protocol = raw.protocol as PortProtocolFilter;
  }

  let nameFilter: string | undefined;
  if (raw.nameFilter !== undefined && raw.nameFilter !== null) {
    if (typeof raw.nameFilter !== "string") return { ok: false, message: "'nameFilter' must be a string." };
    if (raw.nameFilter.trim() !== "") nameFilter = raw.nameFilter.trim().toLowerCase();
  }

  let limit = DEFAULT_ITEMS_LIMIT;
  if (raw.limit !== undefined && raw.limit !== null) {
    if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1) {
      return { ok: false, message: `'limit' must be a positive integer (max ${MAX_ITEMS_LIMIT}).` };
    }
    limit = Math.min(raw.limit, MAX_ITEMS_LIMIT);
  }

  return {
    ok: true,
    args: {
      section: raw.section as SystemSection,
      status,
      sortBy,
      protocol,
      nameFilter,
      limit,
    },
  };
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

/** Lo que recibe cada sección: el lector del sistema, la señal de cancelación y los argumentos ya validados. */
interface SectionContext {
  readonly reader: SystemReader;
  readonly signal: AbortSignal | undefined;
  readonly args: ParsedSystemArgs;
}

type SectionRunner = (ctx: SectionContext) => Promise<MCPCallResult>;

const sectionResult = (text: string, raw: string, truncated: boolean, sections: Record<string, unknown>): MCPCallResult =>
  toolResult({ text, raw, data: { state: "ok", truncated, sections } });

/** Cabecera y líneas ajustadas al presupuesto de texto (con el marcador de lo omitido); `raw` conserva todas las líneas. */
function fitSection(header: string, lines: readonly string[], noun: string) {
  const fitted = fitLinesToBudget(header, lines, BUDGET.summaryMax);
  const omitted = lines.length - fitted.shown.length;
  return {
    text: [header, ...fitted.shown, ...(omitted > 0 ? [omissionMarker(omitted, noun)] : [])].join("\n"),
    raw: [header, ...lines].join("\n"),
    truncated: fitted.truncated,
    shown: fitted.shown.length,
  };
}

/** Una lectura que puede fallar: si la cancelaron es `cancelled`; si falla por otra causa, un error que empieza con `failure`. */
async function guarded(failure: string, signal: AbortSignal | undefined, read: () => Promise<MCPCallResult>): Promise<MCPCallResult> {
  try {
    return await read();
  } catch (error) {
    if (signal?.aborted) return cancelledResult();
    return fail(`${failure}: ${errorMessage(error)}`);
  }
}

// ───────────────────────── Lecturas que no abortan la sección si fallan ─────────────────────────

type Safe<T, K extends string> = ({ readonly ok: true } & { readonly [P in K]: T }) | { readonly ok: false; readonly reason: string };

function readHostSafe(reader: SystemReader): Safe<HostOsInfo, "host"> {
  try {
    return { ok: true, host: reader.readHost() };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

async function readGpusSafe(reader: SystemReader, signal: AbortSignal | undefined): Promise<Safe<readonly string[], "gpus">> {
  try {
    return { ok: true, gpus: await reader.readGpus(signal) };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

async function readDisksSafe(reader: SystemReader, signal: AbortSignal | undefined): Promise<Safe<readonly DiskInfo[], "disks">> {
  try {
    return { ok: true, disks: await reader.readDisks(signal) };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

/** CPU, RAM y GPU: si falla una parte, esa parte sale como desconocida; solo si fallan las dos no hay sección. */
async function buildHardware({ reader, signal }: SectionContext) {
  const [hostRes, gpusRes] = [readHostSafe(reader), await readGpusSafe(reader, signal)];
  if (!hostRes.ok && !gpusRes.ok) return { ok: false as const, reason: hostRes.reason };
  const gpusValue = gpusRes.ok ? gpusRes.gpus : unknownValue(gpusRes.reason);
  const gpuText = gpusRes.ok ? (gpusRes.gpus.length > 0 ? gpusRes.gpus.join(", ") : "none detected") : `unknown (${gpusRes.reason})`;

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
    data: { cpuModel: h.cpuModel, cores: h.cores, totalMemBytes: h.totalMemBytes, freeMemBytes: h.freeMemBytes, gpus: gpusValue },
    lines: [`CPU: ${h.cpuModel} (${h.cores} cores)`, `RAM: ${formatSize(h.freeMemBytes)} free / ${formatSize(h.totalMemBytes)}`, `GPU: ${gpuText}`],
  };
}

function buildOs({ reader }: SectionContext) {
  const hostRes = readHostSafe(reader);
  if (!hostRes.ok) return { ok: false as const, reason: hostRes.reason };
  const h = hostRes.host;
  const userText = typeof h.user === "string" ? h.user : `unknown (${h.user.reason})`;
  return {
    ok: true as const,
    data: { name: h.osName, version: h.osVersion, build: h.osBuild, arch: h.arch, uptimeSec: h.uptimeSec, user: h.user },
    lines: [`OS: ${h.osName} ${h.osVersion} (build ${h.osBuild}, ${h.arch})`, `Uptime: ${formatUptime(h.uptimeSec)}`, `User: ${userText}`],
  };
}

// ───────────────────────── Secciones ─────────────────────────

const datetimeSection: SectionRunner = async ({ reader, signal }) =>
  guarded("Could not read date/time", signal, async () => {
    const dt = reader.readDateTime();
    const sign = dt.utcOffsetMinutes >= 0 ? "+" : "-";
    const absMins = Math.abs(dt.utcOffsetMinutes);
    const offH = String(Math.floor(absMins / 60)).padStart(2, "0");
    const offM = String(absMins % 60).padStart(2, "0");
    const text = [
      "status: ok · section: datetime",
      `Local: ${dt.localDateTime} (UTC${sign}${offH}:${offM})`,
      `Time zone: ${dt.timeZone}`,
      `ISO: ${dt.iso}`,
    ].join("\n");
    return sectionResult(text, text, false, { datetime: dt });
  });

const networkSection: SectionRunner = async ({ reader, signal }) =>
  guarded("Could not read network info", signal, async () => {
    const net = await reader.readNetwork(signal);
    if (signal?.aborted) return cancelledResult();
    const lines: string[] = [`Hostname: ${net.hostname}`];
    if (net.wifiSsid) lines.push(`Wi-Fi SSID: ${net.wifiSsid}`);
    if (net.defaultGateway) lines.push(`Gateway: ${net.defaultGateway}`);
    if (net.dnsServers && net.dnsServers.length > 0) lines.push(`DNS: ${net.dnsServers.join(", ")}`);
    for (const iface of net.interfaces) {
      const tag = iface.internal ? "loopback" : "external";
      lines.push(`[${tag}] ${iface.name}: ${iface.addresses.join(", ")}${iface.mac ? ` (MAC ${iface.mac})` : ""}`);
    }
    const fitted = fitSection(`status: ok · section: network (${net.interfaces.length} interface(s))`, lines, "interfaces");
    return sectionResult(fitted.text, fitted.raw, fitted.truncated, { network: net });
  });

const processesSection: SectionRunner = async ({ reader, signal, args }) =>
  guarded("Could not list processes", signal, async () => {
    const { sortBy, nameFilter, limit } = args;
    const all = await reader.readProcesses(signal);
    if (signal?.aborted) return cancelledResult();
    const filtered = nameFilter ? all.filter((p) => p.name.toLowerCase().includes(nameFilter)) : [...all];
    filtered.sort((a, b) => {
      if (sortBy === "cpu") return b.cpuSec - a.cpuSec || b.memoryBytes - a.memoryBytes;
      if (sortBy === "name") return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.pid - b.pid;
      return b.memoryBytes - a.memoryBytes || b.cpuSec - a.cpuSec;
    });
    const limited = filtered.slice(0, limit);
    const lines =
      limited.length === 0
        ? ["No matching processes."]
        : limited.map((p) => `PID ${p.pid} · ${p.name} · RAM ${formatSize(p.memoryBytes)} · CPU ${p.cpuSec.toFixed(1)}s${p.windowTitle ? ` · "${p.windowTitle}"` : ""}`);
    const fitted = fitSection(`status: ok · section: processes (showing ${limited.length} of ${filtered.length}, sorted by ${sortBy})`, lines, "procesos");
    return sectionResult(fitted.text, fitted.raw, fitted.truncated || limited.length < filtered.length, {
      processes: { total: filtered.length, shown: Math.min(fitted.shown, limited.length), sortBy, items: limited },
    });
  });

const portsSection: SectionRunner = async ({ reader, signal, args }) =>
  guarded("Could not list ports", signal, async () => {
    const { protocol, nameFilter, limit } = args;
    const all = await reader.readPorts(signal);
    if (signal?.aborted) return cancelledResult();
    const filtered = all
      .filter((p) => protocol === "all" || p.protocol === protocol)
      .filter((p) => !nameFilter || (p.processName?.toLowerCase().includes(nameFilter) ?? false))
      .sort((a, b) => a.localPort - b.localPort || a.protocol.localeCompare(b.protocol));
    const limited = filtered.slice(0, limit);
    const lines =
      limited.length === 0
        ? ["No listening ports matched."]
        : limited.map((p) => `${p.protocol.toUpperCase()} ${p.localAddress}:${p.localPort}${p.state ? ` [${p.state}]` : ""} · PID ${p.pid}${p.processName ? ` (${p.processName})` : ""}`);
    const fitted = fitSection(`status: ok · section: ports (${protocol}, showing ${limited.length} of ${filtered.length})`, lines, "puertos");
    return sectionResult(fitted.text, fitted.raw, fitted.truncated || limited.length < filtered.length, {
      ports: { total: filtered.length, shown: Math.min(fitted.shown, limited.length), protocol, items: limited },
    });
  });

const servicesSection: SectionRunner = async ({ reader, signal, args }) =>
  guarded("Could not read services", signal, async () => {
    const { status, nameFilter, limit } = args;
    const all = await reader.readServices(signal);
    if (signal?.aborted) return cancelledResult();
    const filtered = all
      .filter((s) => status === "all" || s.status.toLowerCase() === status)
      .filter((s) => !nameFilter || s.name.toLowerCase().includes(nameFilter) || s.displayName.toLowerCase().includes(nameFilter))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const limited = filtered.slice(0, limit);
    const lines = limited.length === 0 ? ["No matching services."] : limited.map((s) => `[${s.status}] ${s.name} — ${s.displayName}`);
    const fitted = fitSection(`status: ok · section: services (${status}) · showing ${limited.length} of ${filtered.length}`, lines, "servicios");
    return sectionResult(fitted.text, fitted.raw, fitted.truncated || limited.length < filtered.length, {
      services: { filter: status, total: filtered.length, shown: Math.min(fitted.shown, limited.length), items: limited },
    });
  });

const devToolsSection: SectionRunner = async ({ reader, signal }) =>
  guarded("Could not check dev tools", signal, async () => {
    const tools = await reader.readDevTools(DEV_TOOLS_LIST, signal);
    if (signal?.aborted) return cancelledResult();
    const lines = tools.map((t) =>
      t.installed === true
        ? `[installed] ${t.name}: ${t.version ?? "yes"}`
        : t.installed === false
          ? `[missing]   ${t.name}`
          : `[unknown]   ${t.name}: ${t.reason ?? "unreadable"}`,
    );
    const installedCount = tools.filter((t) => t.installed === true).length;
    const text = [`status: ok · section: dev_tools (${installedCount}/${tools.length} installed)`, ...lines].join("\n");
    return sectionResult(text, text, false, { dev_tools: tools });
  });

const hardwareSection: SectionRunner = async (ctx) => {
  const hw = await buildHardware(ctx);
  if (ctx.signal?.aborted) return cancelledResult();
  if (!hw.ok) return fail(`Could not read hardware info: ${hw.reason}`);
  const text = ["status: ok · section: hardware", ...hw.lines].join("\n");
  return sectionResult(text, text, false, { hardware: hw.data });
};

const osSection: SectionRunner = async (ctx) => {
  const os = buildOs(ctx);
  if (!os.ok) return fail(`Could not read OS info: ${os.reason}`);
  const text = ["status: ok · section: os", ...os.lines].join("\n");
  return sectionResult(text, text, false, { os: os.data });
};

const disksSection: SectionRunner = async ({ reader, signal }) => {
  const res = await readDisksSafe(reader, signal);
  if (signal?.aborted) return cancelledResult();
  if (!res.ok) return fail(`Could not read disk info: ${res.reason}`);
  const lines = res.disks.length === 0 ? ["No fixed disks detected."] : res.disks.map(formatDiskLine);
  const fitted = fitSection(`status: ok · section: disks (${res.disks.length})`, lines, "discos");
  return sectionResult(fitted.text, fitted.raw, fitted.truncated, { disks: res.disks });
};

/** Hardware, sistema y discos en una sola respuesta: lo que falla sale como desconocido; solo si falla todo es un error. */
const overviewSection: SectionRunner = async (ctx) => {
  const [hw, os, disks] = await Promise.all([buildHardware(ctx), Promise.resolve(buildOs(ctx)), readDisksSafe(ctx.reader, ctx.signal)]);
  if (ctx.signal?.aborted) return cancelledResult();
  if (!hw.ok && !os.ok && !disks.ok) return fail(`Could not read system overview: ${hw.reason}; ${os.reason}; ${disks.reason}`);
  const text = [
    "status: ok · section: overview",
    ...(hw.ok ? hw.lines : [`Hardware: unknown (${hw.reason})`]),
    ...(os.ok ? os.lines : [`OS: unknown (${os.reason})`]),
    ...(disks.ok
      ? disks.disks.length === 0
        ? ["Disks: none detected"]
        : ["Disks:", ...disks.disks.map((d) => `  ${formatDiskLine(d)}`)]
      : [`Disks: unknown (${disks.reason})`]),
  ].join("\n");
  return sectionResult(text, text, false, {
    hardware: hw.ok ? hw.data : unknownValue(hw.reason),
    os: os.ok ? os.data : unknownValue(os.reason),
    disks: disks.ok ? disks.disks : unknownValue(disks.reason),
  });
};

/** Una función por sección: agregar una sección es agregar una fila (y su nombre en `SYSTEM_SECTIONS`). */
const SECTION_RUNNERS: Record<SystemSection, SectionRunner> = {
  overview: overviewSection,
  hardware: hardwareSection,
  os: osSection,
  disks: disksSection,
  services: servicesSection,
  dev_tools: devToolsSection,
  processes: processesSection,
  ports: portsSection,
  network: networkSection,
  datetime: datetimeSection,
};

export async function runSystemInfo(
  rawArgs: Record<string, unknown>,
  deps: SystemInfoDeps,
  options: { readonly signal?: AbortSignal } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  const parsed = parseArgs(rawArgs);
  if (!parsed.ok) return fail(parsed.message);
  return SECTION_RUNNERS[parsed.args.section]({ reader: deps.reader, signal: options.signal, args: parsed.args });
}
