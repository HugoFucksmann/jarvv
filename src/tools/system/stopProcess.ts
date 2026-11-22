/**
 * `jarvis_system`: herramienta `stop_process`.
 *
 * Termina procesos por `pid` o por `name` con protecciones estrictas:
 * - Impide matar el propio proceso de JARVIS (`process.pid`), su proceso padre (`process.ppid`)
 *   o procesos críticos del sistema operativo (`csrss`, `lsass`, `wininit`, `services`, `systemd`, etc.).
 * - Pasa PID o nombre al subproceso PowerShell mediante variables de entorno (`$env:JARVIS_STOP_PID`,
 *   `$env:JARVIS_STOP_NAME`), nunca interpolados en cadena de comandos.
 * - Usa un controlador inyectable (`ProcessKiller`) para pruebas deterministas sin matar procesos reales.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { effectiveTimeoutMs } from "../../core/tools/filePaths.ts";
import { cancelledResult, toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage, isRecord } from "../../core/utils.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_STOP_PROCESS_TIMEOUT_MS = 8_000;

export const PROTECTED_PROCESS_NAMES: ReadonlySet<string> = new Set([
  "system",
  "registry",
  "idle",
  "smss",
  "csrss",
  "wininit",
  "services",
  "lsass",
  "lsm",
  "winlogon",
  "dwm",
  "fontdrvhost",
  "svchost",
  "memory compression",
  "init",
  "systemd",
  "launchd",
]);

export interface StoppedProcessItem {
  readonly pid: number;
  readonly name: string;
}

export interface ProcessKiller {
  stopByPid(pid: number, force: boolean, signal?: AbortSignal): Promise<readonly StoppedProcessItem[]>;
  stopByName(name: string, force: boolean, signal?: AbortSignal): Promise<readonly StoppedProcessItem[]>;
}

export interface StopProcessDeps {
  readonly killer?: ProcessKiller;
  readonly platform?: NodeJS.Platform;
  readonly defaultTimeoutMs?: number;
  readonly selfPid?: number;
  readonly parentPid?: number;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const PS_UTF8_PREFIX = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)";

const PS_STOP_BY_PID = [
  PS_UTF8_PREFIX,
  "$targetPid = [int]$env:JARVIS_STOP_PID",
  "$force = $env:JARVIS_STOP_FORCE -eq '1'",
  "$p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue",
  "if ($null -eq $p) { '[]'; exit 0 }",
  "if ($force) { Stop-Process -Id $targetPid -Force -ErrorAction Stop } else { Stop-Process -Id $targetPid -ErrorAction Stop }",
  "@([pscustomobject]@{ Pid = $p.Id; Name = $p.ProcessName }) | ConvertTo-Json -Compress",
].join("; ");

const PS_STOP_BY_NAME = [
  PS_UTF8_PREFIX,
  "$targetName = $env:JARVIS_STOP_NAME",
  "$force = $env:JARVIS_STOP_FORCE -eq '1'",
  "$procs = @(Get-Process -Name $targetName -ErrorAction SilentlyContinue)",
  "if ($procs.Count -eq 0) { '[]'; exit 0 }",
  "$selfPid = [int]$env:JARVIS_SELF_PID",
  "$parentPid = [int]$env:JARVIS_PARENT_PID",
  "$safe = @($procs | Where-Object { $_.Id -ne $selfPid -and $_.Id -ne $parentPid -and $_.Id -gt 4 })",
  "if ($safe.Count -eq 0) { throw 'Only protected or self processes matched that name.' }",
  "foreach ($p in $safe) {",
  "  if ($force) { Stop-Process -Id $p.Id -Force -ErrorAction Stop } else { Stop-Process -Id $p.Id -ErrorAction Stop }",
  "}",
  "@($safe | ForEach-Object { [pscustomobject]@{ Pid = $_.Id; Name = $_.ProcessName } }) | ConvertTo-Json -Compress",
].join("; ");

function parseStoppedRows(stdout: string): StoppedProcessItem[] {
  const trimmed = stdout.trim();
  if (trimmed === "" || trimmed === "null") return [];
  const parsed: unknown = JSON.parse(trimmed);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const out: StoppedProcessItem[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const pid = typeof row.Pid === "number" ? row.Pid : typeof row.pid === "number" ? row.pid : NaN;
    const name = typeof row.Name === "string" ? row.Name : typeof row.name === "string" ? row.name : "unknown";
    if (Number.isInteger(pid) && pid > 0) {
      out.push({ pid, name });
    }
  }
  return out;
}

export function createDefaultProcessKiller(
  platform: NodeJS.Platform = process.platform,
  timeoutMs = DEFAULT_STOP_PROCESS_TIMEOUT_MS,
  selfPid = process.pid,
  parentPid = process.ppid,
): ProcessKiller {
  const requireWindows = (): void => {
    if (platform !== "win32") {
      throw new Error(`Process control requires Windows PowerShell (current platform: ${platform}).`);
    }
  };

  return {
    async stopByPid(pid: number, force: boolean, signal?: AbortSignal): Promise<readonly StoppedProcessItem[]> {
      requireWindows();
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", PS_STOP_BY_PID],
        {
          timeout: timeoutMs,
          windowsHide: true,
          signal,
          env: {
            ...process.env,
            JARVIS_STOP_PID: String(pid),
            JARVIS_STOP_FORCE: force ? "1" : "0",
          },
        },
      );
      return parseStoppedRows(stdout);
    },
    async stopByName(name: string, force: boolean, signal?: AbortSignal): Promise<readonly StoppedProcessItem[]> {
      requireWindows();
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", PS_STOP_BY_NAME],
        {
          timeout: timeoutMs,
          windowsHide: true,
          signal,
          env: {
            ...process.env,
            JARVIS_STOP_NAME: name,
            JARVIS_STOP_FORCE: force ? "1" : "0",
            JARVIS_SELF_PID: String(selfPid),
            JARVIS_PARENT_PID: String(parentPid),
          },
        },
      );
      return parseStoppedRows(stdout);
    },
  };
}

function normalizeProcessName(rawName: string): string {
  return rawName.trim().replace(/\.exe$/i, "");
}

function isProtectedProcessName(normalizedName: string): boolean {
  return PROTECTED_PROCESS_NAMES.has(normalizedName.toLowerCase());
}

export async function runStopProcess(
  rawArgs: Record<string, unknown>,
  deps: StopProcessDeps = {},
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  let pid: number | undefined;
  if (rawArgs.pid !== undefined && rawArgs.pid !== null) {
    if (typeof rawArgs.pid !== "number" || !Number.isInteger(rawArgs.pid) || rawArgs.pid < 1) {
      return fail("'pid' must be a positive integer.");
    }
    pid = rawArgs.pid;
  }

  let name: string | undefined;
  if (rawArgs.name !== undefined && rawArgs.name !== null) {
    if (typeof rawArgs.name !== "string" || rawArgs.name.trim() === "") {
      return fail("'name' must be a non-empty process name (e.g. 'notepad').");
    }
    const rawTrimmed = rawArgs.name.trim();
    if (/[\r\n\0;|&`<>]/.test(rawTrimmed)) {
      return fail("'name' contains invalid characters.");
    }
    name = normalizeProcessName(rawTrimmed);
    if (name === "") return fail("'name' must not be empty.");
  }

  if (pid === undefined && name === undefined) {
    return fail("Provide either 'pid' or 'name' to identify the process to stop.");
  }
  if (pid !== undefined && name !== undefined) {
    return fail("Provide either 'pid' or 'name', not both.");
  }

  let force = false;
  if (rawArgs.force !== undefined && rawArgs.force !== null) {
    if (typeof rawArgs.force !== "boolean") return fail("'force' must be true or false.");
    force = rawArgs.force;
  }

  const selfPid = deps.selfPid ?? process.pid;
  const parentPid = deps.parentPid ?? process.ppid;
  const platform = deps.platform ?? process.platform;

  if (pid !== undefined) {
    if (pid === selfPid || pid === parentPid) {
      return fail(`[DENIED] Refusing to stop JARVIS or its parent process (PID ${pid}).`, { reason: "denied" });
    }
    if (pid <= 4 && platform === "win32") {
      return fail(`[DENIED] Refusing to stop critical system PID ${pid}.`, { reason: "denied" });
    }
    if (pid === 1 && platform !== "win32") {
      return fail("[DENIED] Refusing to stop PID 1 (init/systemd).", { reason: "denied" });
    }
  }

  if (name !== undefined && isProtectedProcessName(name)) {
    return fail(`[DENIED] Refusing to stop critical system process '${name}'.`, { reason: "denied" });
  }

  const timeoutMs = effectiveTimeoutMs(deps.defaultTimeoutMs ?? DEFAULT_STOP_PROCESS_TIMEOUT_MS, options.timeoutMs);
  const killer = deps.killer ?? createDefaultProcessKiller(platform, timeoutMs, selfPid, parentPid);

  try {
    const stopped =
      pid !== undefined
        ? await killer.stopByPid(pid, force, options.signal)
        : // biome-ignore lint/style/noNonNullAssertion: sin `pid`, `name` está presente: se validó que venga exactamente uno de los dos.
          await killer.stopByName(name!, force, options.signal);

    if (options.signal?.aborted) return cancelledResult();

    if (stopped.length === 0) {
      const targetDesc = pid !== undefined ? `PID ${pid}` : `name '${name}'`;
      return fail(`No running process matched ${targetDesc}.`, { reason: "not_found" });
    }

    const listText = stopped.map((p) => `${p.name} (PID ${p.pid})`).join(", ");
    const text = `status: ok · stopped ${stopped.length} process(es)${force ? " (forced)" : ""}: ${listText}`;
    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        forced: force,
        count: stopped.length,
        stopped,
        truncated: false,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    return fail(`Could not stop process: ${errorMessage(error)}`);
  }
}
