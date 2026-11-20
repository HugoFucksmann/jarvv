/**
 * `jarvis_system`: herramienta `open_on_screen`.
 *
 * Abre una aplicación, URL `http(s)` o ruta local en la pantalla del usuario.
 * - No devuelve contenido del archivo a Jarvis (para leer un archivo se usa `read_file`).
 * - Rechaza esquemas peligrosos (`javascript:`, `vbscript:`, `data:`, `file:` como URL).
 * - Cuando el objetivo es una ruta local o alias (`home`, `desktop`, `documents`, `downloads`),
 *   valida `allowedDirectories` y existencia antes de abrir.
 * - Pasa el destino por variable de entorno `$env:JARVIS_OPEN_TARGET` (nunca interpolado en string).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { UserEnvironment } from "../../core/environment.ts";
import { isAnyAbsolute } from "../../core/policy/allowedDirs.ts";
import { KNOWN_ALIASES, resolveExistingPath } from "../../core/tools/filePaths.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_OPEN_TIMEOUT_MS = 8_000;
const VALID_TYPES = ["auto", "app", "url", "path"] as const;
export type OpenTargetType = (typeof VALID_TYPES)[number];
export type ResolvedOpenKind = "app" | "url" | "path";

export interface ScreenOpener {
  open(params: {
    readonly target: string;
    readonly kind: ResolvedOpenKind;
    readonly signal?: AbortSignal;
  }): Promise<void>;
}

export interface OpenOnScreenDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly opener?: ScreenOpener;
  readonly platform?: NodeJS.Platform;
  readonly defaultTimeoutMs?: number;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", truncated: false } });

const PS_OPEN_SCRIPT = "Start-Process -FilePath $env:JARVIS_OPEN_TARGET";

export function createDefaultScreenOpener(
  platform: NodeJS.Platform = process.platform,
  timeoutMs = DEFAULT_OPEN_TIMEOUT_MS,
): ScreenOpener {
  return {
    async open({ target, signal }) {
      if (platform !== "win32") {
        throw new Error(`Opening on screen requires Windows (current platform: ${platform}).`);
      }
      await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_OPEN_SCRIPT], {
        timeout: timeoutMs,
        windowsHide: true,
        signal,
        env: { ...process.env, JARVIS_OPEN_TARGET: target },
      });
    },
  };
}

function inferKind(target: string, requested: OpenTargetType): ResolvedOpenKind {
  if (requested !== "auto") return requested;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[A-Za-z]:[\\/]/.test(target)) {
    return "url";
  }
  if ((KNOWN_ALIASES as readonly string[]).includes(target.toLowerCase())) {
    return "path";
  }
  if (target.startsWith("~") || isAnyAbsolute(target)) {
    return "path";
  }
  return "app";
}

function validateSafeAppTarget(target: string): string | null {
  if (/[\r\n\0;|&`<>]/.test(target)) {
    return "Application name contains invalid control or shell characters.";
  }
  if (target.length > 260) {
    return "Application name is too long.";
  }
  return null;
}

export async function runOpenOnScreen(
  rawArgs: Record<string, unknown>,
  deps: OpenOnScreenDeps,
  options: { readonly signal?: AbortSignal } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  if (typeof rawArgs.target !== "string" || rawArgs.target.trim() === "") {
    return fail("'target' is required: an application name, http(s) URL, or local file/folder path.");
  }
  const rawTarget = rawArgs.target.trim();
  if (rawTarget.includes("\0")) {
    return fail("'target' contains invalid null bytes.");
  }

  let requestedType: OpenTargetType = "auto";
  if (rawArgs.type !== undefined && rawArgs.type !== null) {
    if (typeof rawArgs.type !== "string" || !(VALID_TYPES as readonly string[]).includes(rawArgs.type)) {
      return fail(`'type' must be one of: ${VALID_TYPES.join(", ")}.`);
    }
    requestedType = rawArgs.type as OpenTargetType;
  }

  const kind = inferKind(rawTarget, requestedType);
  let resolvedTarget = rawTarget;

  if (kind === "url") {
    let url: URL;
    try {
      url = new URL(rawTarget);
    } catch {
      return fail(`'${rawTarget}' is not a valid URL.`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fail(`Only http and https URLs can be opened on screen (got '${url.protocol}').`);
    }
    resolvedTarget = url.toString();
  } else if (kind === "path") {
    const resolved = await resolveExistingPath(rawTarget, deps.getEnvironment, deps.getAllowedDirectories(), {
      expectedKind: "any",
      followSymlinkForAllowedCheck: true,
      paramName: "target",
    });
    if (!resolved.ok) {
      return fail(resolved.message, {
        ...(resolved.denied ? { reason: "denied" } : resolved.notFound ? { reason: "not_found" } : {}),
      });
    }
    resolvedTarget = resolved.targetPath;
  } else {
    const appErr = validateSafeAppTarget(rawTarget);
    if (appErr !== null) return fail(appErr);
  }

  if (options.signal?.aborted) return cancelledResult();

  const opener =
    deps.opener ??
    createDefaultScreenOpener(deps.platform ?? process.platform, deps.defaultTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);

  try {
    await opener.open({ target: resolvedTarget, kind, signal: options.signal });
    if (options.signal?.aborted) return cancelledResult();
    const note = kind === "path" ? " (opened for the user; file content is not returned—use read_file to inspect)" : "";
    const text = `status: ok · opened ${kind} on screen: ${resolvedTarget}${note}`;
    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        kind,
        target: resolvedTarget,
        truncated: false,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    return fail(`Could not open '${resolvedTarget}' on screen: ${errorMessage(error)}`);
  }
}
