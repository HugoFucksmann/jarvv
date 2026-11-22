/**
 * `jarvis_system`: herramienta `clipboard`.
 *
 * Lee o escribe el portapapeles del sistema mediante un driver inyectable:
 * - En Windows usa PowerShell (`Get-Clipboard -Raw` / `Set-Clipboard`) pasando el texto de
 *   escritura por `stdin` en UTF-8 para evitar límites de línea de comando e inyección de comillas.
 * - Limpia siempre timers, listeners de `AbortSignal` y subprocesos en `finally`.
 */

import { spawn } from "node:child_process";
import { BUDGET } from "../../core/budget.ts";
import { headTailNeutral } from "../../core/text.ts";
import { effectiveTimeoutMs } from "../../core/tools/filePaths.ts";
import { cancelledResult, toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

export const DEFAULT_CLIPBOARD_TIMEOUT_MS = 5_000;
export const MAX_CLIPBOARD_WRITE_CHARS = 1_000_000;
const MAX_STDERR_BYTES = 64 * 1024;
/** Lo máximo que se lee del portapapeles: el doble de lo que se deja escribir, en bytes (UTF-8 usa hasta 4 por carácter). Más que eso es un error, no un texto cortado. */
export const MAX_CLIPBOARD_READ_BYTES = MAX_CLIPBOARD_WRITE_CHARS * 4;

export interface ClipboardDriver {
  read(signal?: AbortSignal): Promise<string>;
  write(text: string, signal?: AbortSignal): Promise<void>;
}

export interface ClipboardDeps {
  readonly driver?: ClipboardDriver;
  readonly platform?: NodeJS.Platform;
  readonly defaultTimeoutMs?: number;
}

const VALID_ACTIONS = ["read", "write"] as const;
type ClipboardAction = (typeof VALID_ACTIONS)[number];

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const PS_READ_CLIPBOARD = [
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
  "$v = Get-Clipboard -Raw",
  "if ($null -ne $v) { [Console]::Out.Write($v) }",
].join("; ");

const PS_WRITE_CLIPBOARD = [
  "[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)",
  "$text = [Console]::In.ReadToEnd()",
  "Set-Clipboard -Value $text",
].join("; ");

export function runPowerShellIo(
  script: string,
  stdinText: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Clipboard operation cancelled"));
      return;
    }

    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      if (onAbort !== undefined && signal !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    };

    const finishErr = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finishErr(new Error(`Clipboard operation timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    const onAbort = signal
      ? () => {
          try {
            child.kill();
          } catch {
            // ignore
          }
          finishErr(new Error("Clipboard operation cancelled"));
        }
      : undefined;

    if (onAbort !== undefined && signal !== undefined) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdin.on("error", () => {});
    child.stdout.on("error", () => {});
    child.stderr.on("error", () => {});
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_CLIPBOARD_READ_BYTES) {
        try {
          child.kill();
        } catch {
          // ignore
        }
        finishErr(new Error(`The clipboard holds more than ${MAX_CLIPBOARD_READ_BYTES} bytes: too large to read.`));
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return;
      const slice = chunk.length + stderrBytes > MAX_STDERR_BYTES ? chunk.subarray(0, MAX_STDERR_BYTES - stderrBytes) : chunk;
      stderrChunks.push(slice);
      stderrBytes += slice.length;
    });
    child.on("error", (err) => finishErr(err));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const stdoutText = Buffer.concat(stdoutChunks).toString("utf8");
      const errText = Buffer.concat(stderrChunks).toString("utf8").trim();
      cleanup();
      if (code !== 0) {
        reject(new Error(errText || `PowerShell exited with code ${code}`));
        return;
      }
      resolve(stdoutText);
    });

    if (stdinText !== undefined) {
      child.stdin.end(stdinText, "utf8");
    } else {
      child.stdin.end();
    }
  });
}

export function createDefaultClipboardDriver(
  platform: NodeJS.Platform = process.platform,
  timeoutMs = DEFAULT_CLIPBOARD_TIMEOUT_MS,
): ClipboardDriver {
  const requireWindows = (): void => {
    if (platform !== "win32") {
      throw new Error(`Clipboard requires Windows PowerShell (current platform: ${platform}).`);
    }
  };

  return {
    async read(signal?: AbortSignal): Promise<string> {
      requireWindows();
      return runPowerShellIo(PS_READ_CLIPBOARD, undefined, timeoutMs, signal);
    },
    async write(text: string, signal?: AbortSignal): Promise<void> {
      requireWindows();
      await runPowerShellIo(PS_WRITE_CLIPBOARD, text, timeoutMs, signal);
    },
  };
}

export async function runClipboard(
  rawArgs: Record<string, unknown>,
  deps: ClipboardDeps = {},
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  if (typeof rawArgs.action !== "string" || !(VALID_ACTIONS as readonly string[]).includes(rawArgs.action)) {
    return fail(`'action' is required and must be one of: ${VALID_ACTIONS.join(", ")}.`);
  }
  const action = rawArgs.action as ClipboardAction;
  const timeoutMs = effectiveTimeoutMs(deps.defaultTimeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS, options.timeoutMs);
  const driver = deps.driver ?? createDefaultClipboardDriver(deps.platform ?? process.platform, timeoutMs);

  if (action === "write") {
    if (typeof rawArgs.text !== "string") {
      return fail("'text' is required when action is 'write'.");
    }
    if (rawArgs.text.length > MAX_CLIPBOARD_WRITE_CHARS) {
      return fail(`'text' is too large for clipboard (max ${MAX_CLIPBOARD_WRITE_CHARS} characters).`);
    }
    try {
      await driver.write(rawArgs.text, options.signal);
      if (options.signal?.aborted) return cancelledResult();
      const text = `status: ok · copied ${rawArgs.text.length} character(s) to clipboard`;
      return toolResult({
        text,
        raw: text,
        data: { state: "ok", action: "write", chars: rawArgs.text.length, truncated: false },
      });
    } catch (error) {
      if (options.signal?.aborted) return cancelledResult();
      return fail(`Could not write clipboard: ${errorMessage(error)}`);
    }
  }

  try {
    const content = await driver.read(options.signal);
    if (options.signal?.aborted) return cancelledResult();
    if (content === "") {
      const text = "status: ok · clipboard is empty";
      return toolResult({
        text,
        raw: "",
        data: { state: "ok", action: "read", empty: true, chars: 0, truncated: false },
      });
    }
    const header = `status: ok · clipboard (${content.length} chars)`;
    const maxBody = Math.max(BUDGET.summaryMax - header.length - 60, 200);
    const clipped = headTailNeutral(content, Math.floor(maxBody * 0.6), Math.floor(maxBody * 0.4));
    const text = `${header}\n${clipped.text}`;
    return toolResult({
      text,
      raw: content,
      data: {
        state: "ok",
        action: "read",
        empty: false,
        chars: content.length,
        truncated: clipped.clipped,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    return fail(`Could not read clipboard: ${errorMessage(error)}`);
  }
}
