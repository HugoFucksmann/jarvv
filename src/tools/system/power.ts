/**
 * `jarvis_system`: herramienta `power`.
 *
 * Ejecuta acciones de energía del equipo: `lock`, `sleep`, `restart`, `shutdown`:
 * - Controlador inyectable (`PowerController`) para probar sin apagar o bloquear la máquina de desarrollo.
 * - En Windows invoca utilidades nativas sin shell (`rundll32.exe`, `shutdown.exe`, PowerShell Win32
 *   `SetSuspendState`) con validación estricta de `delaySec` y `force`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { effectiveTimeoutMs } from "../../core/tools/filePaths.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_POWER_TIMEOUT_MS = 8_000;
export const MAX_POWER_DELAY_SEC = 3_600;

export const POWER_ACTIONS = ["lock", "sleep", "restart", "shutdown"] as const;
export type PowerAction = (typeof POWER_ACTIONS)[number];

export interface PowerRequest {
  readonly action: PowerAction;
  readonly delaySec: number;
  readonly force: boolean;
  readonly signal?: AbortSignal;
}

export interface PowerController {
  execute(req: PowerRequest): Promise<void>;
}

export interface PowerDeps {
  readonly controller?: PowerController;
  readonly platform?: NodeJS.Platform;
  readonly defaultTimeoutMs?: number;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", truncated: false } });

const PS_SLEEP_SCRIPT =
  "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)";

export function createDefaultPowerController(
  platform: NodeJS.Platform = process.platform,
  timeoutMs = DEFAULT_POWER_TIMEOUT_MS,
): PowerController {
  return {
    async execute(req: PowerRequest): Promise<void> {
      if (platform !== "win32") {
        throw new Error(`Power action '${req.action}' requires Windows (current platform: ${platform}).`);
      }

      switch (req.action) {
        case "lock":
          await execFileAsync("rundll32.exe", ["user32.dll,LockWorkStation"], {
            timeout: timeoutMs,
            windowsHide: true,
            signal: req.signal,
          });
          return;
        case "sleep":
          await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_SLEEP_SCRIPT], {
            timeout: timeoutMs,
            windowsHide: true,
            signal: req.signal,
          });
          return;
        case "restart":
        case "shutdown": {
          const args = [req.action === "restart" ? "/r" : "/s", "/t", String(req.delaySec)];
          if (req.force) args.push("/f");
          await execFileAsync("shutdown.exe", args, {
            timeout: timeoutMs,
            windowsHide: true,
            signal: req.signal,
          });
          return;
        }
      }
    },
  };
}

export async function runPower(
  rawArgs: Record<string, unknown>,
  deps: PowerDeps = {},
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  if (typeof rawArgs.action !== "string" || !(POWER_ACTIONS as readonly string[]).includes(rawArgs.action)) {
    return fail(`'action' is required and must be one of: ${POWER_ACTIONS.join(", ")}.`);
  }
  const action = rawArgs.action as PowerAction;

  let delaySec = 0;
  if (rawArgs.delaySec !== undefined && rawArgs.delaySec !== null) {
    if (
      typeof rawArgs.delaySec !== "number" ||
      !Number.isInteger(rawArgs.delaySec) ||
      rawArgs.delaySec < 0 ||
      rawArgs.delaySec > MAX_POWER_DELAY_SEC
    ) {
      return fail(`'delaySec' must be an integer between 0 and ${MAX_POWER_DELAY_SEC}.`);
    }
    if (action !== "restart" && action !== "shutdown" && rawArgs.delaySec > 0) {
      return fail(`'delaySec' is only supported for 'restart' and 'shutdown' (not '${action}').`);
    }
    delaySec = rawArgs.delaySec;
  }

  let force = false;
  if (rawArgs.force !== undefined && rawArgs.force !== null) {
    if (typeof rawArgs.force !== "boolean") return fail("'force' must be true or false.");
    force = rawArgs.force;
  }

  const timeoutMs = effectiveTimeoutMs(deps.defaultTimeoutMs ?? DEFAULT_POWER_TIMEOUT_MS, options.timeoutMs);
  const controller = deps.controller ?? createDefaultPowerController(deps.platform ?? process.platform, timeoutMs);

  try {
    await controller.execute({ action, delaySec, force, signal: options.signal });
    if (options.signal?.aborted) return cancelledResult();

    const suffix =
      (action === "restart" || action === "shutdown") && delaySec > 0 ? ` scheduled in ${delaySec}s` : "";
    const text = `status: ok · power action '${action}'${suffix}${force ? " (forced)" : ""}`;
    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        action,
        delaySec,
        force,
        truncated: false,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    return fail(`Power action '${action}' failed: ${errorMessage(error)}`);
  }
}
