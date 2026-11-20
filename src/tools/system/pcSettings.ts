/**
 * `jarvis_system`: herramienta `pc_settings`.
 *
 * Consulta o modifica ajustes del equipo:
 * - `brightness` (`0..100`)
 * - `wifi` (`on` | `off`)
 * - `bluetooth` (`on` | `off`)
 * - `dark_mode` (`on` | `off`)
 * - `do_not_disturb` (`on` | `off`)
 *
 * Toda interacción real con Windows entra por `PcSettingsDriver` inyectable con scripts fijos
 * de PowerShell (sin interpolación de inputs externos) y soporte estricto de `AbortSignal`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { effectiveTimeoutMs } from "../../core/tools/filePaths.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_PC_SETTINGS_TIMEOUT_MS = 10_000;

export const PC_SETTINGS = ["brightness", "wifi", "bluetooth", "dark_mode", "do_not_disturb"] as const;
export type PcSettingName = (typeof PC_SETTINGS)[number];

export const PC_SETTING_ACTIONS = ["get", "set"] as const;
export type PcSettingAction = (typeof PC_SETTING_ACTIONS)[number];

export type SettingValue = number | "on" | "off";

export interface PcSettingsDriver {
  get(setting: PcSettingName, signal?: AbortSignal): Promise<SettingValue | "unknown">;
  set(setting: PcSettingName, value: SettingValue, signal?: AbortSignal): Promise<SettingValue>;
}

export interface PcSettingsDeps {
  readonly driver?: PcSettingsDriver;
  readonly platform?: NodeJS.Platform;
  readonly defaultTimeoutMs?: number;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", truncated: false } });

const PS_UTF8_PREFIX = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)";

async function runPs(
  script: string,
  envExtra: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      timeout: timeoutMs,
      windowsHide: true,
      signal,
      env: { ...process.env, ...envExtra },
    },
  );
  return stdout.trim();
}

const PS_GET_BRIGHTNESS = [
  PS_UTF8_PREFIX,
  "$b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1",
  "if ($null -eq $b) { throw 'No controllable internal display brightness monitor found.' }",
  "[string]$b.CurrentBrightness",
].join("; ");

const PS_SET_BRIGHTNESS = [
  PS_UTF8_PREFIX,
  "$lvl = [byte][int]$env:JARVIS_BRIGHTNESS",
  "$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1",
  "if ($null -eq $m) { throw 'Display brightness cannot be controlled on this monitor.' }",
  "Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = $lvl } | Out-Null",
  "[string]$lvl",
].join("; ");

const PS_GET_DARK_MODE = [
  PS_UTF8_PREFIX,
  "$p = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'",
  "$v = (Get-ItemProperty -Path $p -Name AppsUseLightTheme -ErrorAction Stop).AppsUseLightTheme",
  "if ([int]$v -eq 0) { 'on' } else { 'off' }",
].join("; ");

const PS_SET_DARK_MODE = [
  PS_UTF8_PREFIX,
  "$p = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'",
  "if (-not (Test-Path $p)) { New-Item -Path $p -Force | Out-Null }",
  "$light = if ($env:JARVIS_TOGGLE -eq 'on') { 0 } else { 1 }",
  "Set-ItemProperty -Path $p -Name AppsUseLightTheme -Value $light -Type DWord -ErrorAction Stop",
  "Set-ItemProperty -Path $p -Name SystemUsesLightTheme -Value $light -Type DWord -ErrorAction Stop",
  "$env:JARVIS_TOGGLE",
].join("; ");

const PS_GET_WIFI = [
  PS_UTF8_PREFIX,
  "$a = Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.InterfaceDescription -match 'Wi-Fi|Wireless|802\\.11' -or $_.Name -match 'Wi-Fi|WLAN' } | Select-Object -First 1",
  "if ($null -eq $a) { throw 'No Wi-Fi adapter found.' }",
  "if ($a.Status -eq 'Disabled') { 'off' } else { 'on' }",
].join("; ");

const PS_SET_WIFI = [
  PS_UTF8_PREFIX,
  "$a = Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.InterfaceDescription -match 'Wi-Fi|Wireless|802\\.11' -or $_.Name -match 'Wi-Fi|WLAN' } | Select-Object -First 1",
  "if ($null -eq $a) { throw 'No Wi-Fi adapter found.' }",
  "if ($env:JARVIS_TOGGLE -eq 'on') { Enable-NetAdapter -Name $a.Name -Confirm:$false -ErrorAction Stop } else { Disable-NetAdapter -Name $a.Name -Confirm:$false -ErrorAction Stop }",
  "$env:JARVIS_TOGGLE",
].join("; ");

const PS_RADIO_SCRIPT = [
  PS_UTF8_PREFIX,
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
  "function Await($op, $type) { $m = $asTaskGeneric.MakeGenericMethod($type); $t = $m.Invoke($null, @($op)); $t.Wait(); return $t.Result }",
  "[void][Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime]",
  "$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])",
  "$targetKind = if ($env:JARVIS_RADIO_KIND -eq 'wifi') { [Windows.Devices.Radios.RadioKind]::WiFi } else { [Windows.Devices.Radios.RadioKind]::Bluetooth }",
  "$r = $radios | Where-Object { $_.Kind -eq $targetKind } | Select-Object -First 1",
  "if ($null -eq $r) { throw \"No $($env:JARVIS_RADIO_KIND) radio device found.\" }",
  "if ($env:JARVIS_RADIO_ACTION -eq 'get') {",
  "  if ($r.State -eq [Windows.Devices.Radios.RadioState]::On) { 'on' } else { 'off' }",
  "} else {",
  "  $desired = if ($env:JARVIS_TOGGLE -eq 'on') { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }",
  "  [void](Await ($r.SetStateAsync($desired)) ([Windows.Devices.Radios.RadioAccessStatus]))",
  "  $env:JARVIS_TOGGLE",
  "}",
].join("; ");

const PS_GET_DND = [
  PS_UTF8_PREFIX,
  "$p = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings'",
  "$v = (Get-ItemProperty -Path $p -Name NOC_GLOBAL_SETTING_TOASTS_ENABLED -ErrorAction SilentlyContinue).NOC_GLOBAL_SETTING_TOASTS_ENABLED",
  "if ($null -eq $v) { 'off' } elseif ([int]$v -eq 0) { 'on' } else { 'off' }",
].join("; ");

const PS_SET_DND = [
  PS_UTF8_PREFIX,
  "$p = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings'",
  "if (-not (Test-Path $p)) { New-Item -Path $p -Force | Out-Null }",
  "$enabled = if ($env:JARVIS_TOGGLE -eq 'on') { 0 } else { 1 }",
  "Set-ItemProperty -Path $p -Name NOC_GLOBAL_SETTING_TOASTS_ENABLED -Value $enabled -Type DWord -ErrorAction Stop",
  "$env:JARVIS_TOGGLE",
].join("; ");

export function createDefaultPcSettingsDriver(
  platform: NodeJS.Platform = process.platform,
  timeoutMs = DEFAULT_PC_SETTINGS_TIMEOUT_MS,
): PcSettingsDriver {
  const requireWindows = (): void => {
    if (platform !== "win32") {
      throw new Error(`PC settings control requires Windows (current platform: ${platform}).`);
    }
  };

  return {
    async get(setting: PcSettingName, signal?: AbortSignal): Promise<SettingValue | "unknown"> {
      requireWindows();
      switch (setting) {
        case "brightness": {
          const out = await runPs(PS_GET_BRIGHTNESS, {}, timeoutMs, signal);
          const num = Number(out);
          return Number.isFinite(num) ? num : "unknown";
        }
        case "dark_mode": {
          const out = await runPs(PS_GET_DARK_MODE, {}, timeoutMs, signal);
          return out === "on" || out === "off" ? out : "unknown";
        }
        case "wifi": {
          try {
            const out = await runPs(PS_RADIO_SCRIPT, { JARVIS_RADIO_KIND: "wifi", JARVIS_RADIO_ACTION: "get" }, timeoutMs, signal);
            if (out === "on" || out === "off") return out;
          } catch {
            // Fallback a NetAdapter
          }
          const out = await runPs(PS_GET_WIFI, {}, timeoutMs, signal);
          return out === "on" || out === "off" ? out : "unknown";
        }
        case "bluetooth": {
          const out = await runPs(PS_RADIO_SCRIPT, { JARVIS_RADIO_KIND: "bluetooth", JARVIS_RADIO_ACTION: "get" }, timeoutMs, signal);
          return out === "on" || out === "off" ? out : "unknown";
        }
        case "do_not_disturb": {
          const out = await runPs(PS_GET_DND, {}, timeoutMs, signal);
          return out === "on" || out === "off" ? out : "unknown";
        }
      }
    },

    async set(setting: PcSettingName, value: SettingValue, signal?: AbortSignal): Promise<SettingValue> {
      requireWindows();
      switch (setting) {
        case "brightness": {
          await runPs(PS_SET_BRIGHTNESS, { JARVIS_BRIGHTNESS: String(value) }, timeoutMs, signal);
          return value;
        }
        case "dark_mode": {
          await runPs(PS_SET_DARK_MODE, { JARVIS_TOGGLE: String(value) }, timeoutMs, signal);
          return value;
        }
        case "wifi": {
          try {
            await runPs(
              PS_RADIO_SCRIPT,
              { JARVIS_RADIO_KIND: "wifi", JARVIS_RADIO_ACTION: "set", JARVIS_TOGGLE: String(value) },
              timeoutMs,
              signal,
            );
            return value;
          } catch {
            await runPs(PS_SET_WIFI, { JARVIS_TOGGLE: String(value) }, timeoutMs, signal);
            return value;
          }
        }
        case "bluetooth": {
          await runPs(
            PS_RADIO_SCRIPT,
            { JARVIS_RADIO_KIND: "bluetooth", JARVIS_RADIO_ACTION: "set", JARVIS_TOGGLE: String(value) },
            timeoutMs,
            signal,
          );
          return value;
        }
        case "do_not_disturb": {
          await runPs(PS_SET_DND, { JARVIS_TOGGLE: String(value) }, timeoutMs, signal);
          return value;
        }
      }
    },
  };
}

function normalizeToggleValue(raw: unknown): { readonly ok: true; readonly value: "on" | "off" } | { readonly ok: false; readonly message: string } {
  if (typeof raw === "boolean") {
    return { ok: true, value: raw ? "on" : "off" };
  }
  if (typeof raw === "string") {
    const clean = raw.trim().toLowerCase();
    if (clean === "on" || clean === "true" || clean === "1" || clean === "enabled" || clean === "enable") {
      return { ok: true, value: "on" };
    }
    if (clean === "off" || clean === "false" || clean === "0" || clean === "disabled" || clean === "disable") {
      return { ok: true, value: "off" };
    }
  }
  return { ok: false, message: "'value' for this setting must be 'on' or 'off' (or true/false)." };
}

export async function runPcSettings(
  rawArgs: Record<string, unknown>,
  deps: PcSettingsDeps = {},
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  if (typeof rawArgs.setting !== "string" || !(PC_SETTINGS as readonly string[]).includes(rawArgs.setting)) {
    return fail(`'setting' is required and must be one of: ${PC_SETTINGS.join(", ")}.`);
  }
  const setting = rawArgs.setting as PcSettingName;

  if (typeof rawArgs.action !== "string" || !(PC_SETTING_ACTIONS as readonly string[]).includes(rawArgs.action)) {
    return fail(`'action' is required and must be one of: ${PC_SETTING_ACTIONS.join(", ")}.`);
  }
  const action = rawArgs.action as PcSettingAction;

  const timeoutMs = effectiveTimeoutMs(deps.defaultTimeoutMs ?? DEFAULT_PC_SETTINGS_TIMEOUT_MS, options.timeoutMs);
  const driver = deps.driver ?? createDefaultPcSettingsDriver(deps.platform ?? process.platform, timeoutMs);

  if (action === "get") {
    try {
      const value = await driver.get(setting, options.signal);
      if (options.signal?.aborted) return cancelledResult();
      const label = typeof value === "number" ? `${value}%` : value;
      const text = `status: ok · ${setting}: ${label}`;
      return toolResult({
        text,
        raw: text,
        data: { state: "ok", action: "get", setting, value, truncated: false },
      });
    } catch (error) {
      if (options.signal?.aborted) return cancelledResult();
      return fail(`Could not read setting '${setting}': ${errorMessage(error)}`);
    }
  }

  let normalizedValue: SettingValue;
  if (setting === "brightness") {
    if (typeof rawArgs.value !== "number" || !Number.isInteger(rawArgs.value) || rawArgs.value < 0 || rawArgs.value > 100) {
      return fail("'value' for brightness must be an integer between 0 and 100.");
    }
    normalizedValue = rawArgs.value;
  } else {
    const parsedToggle = normalizeToggleValue(rawArgs.value);
    if (!parsedToggle.ok) return fail(parsedToggle.message);
    normalizedValue = parsedToggle.value;
  }

  try {
    const applied = await driver.set(setting, normalizedValue, options.signal);
    if (options.signal?.aborted) return cancelledResult();
    const label = typeof applied === "number" ? `${applied}%` : applied;
    const text = `status: ok · set ${setting} -> ${label}`;
    return toolResult({
      text,
      raw: text,
      data: { state: "ok", action: "set", setting, value: applied, truncated: false },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    return fail(`Could not set '${setting}': ${errorMessage(error)}`);
  }
}
