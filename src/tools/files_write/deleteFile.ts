/**
 * `jarvis_files_write`: herramienta `delete_file`.
 *
 * Borra archivos y carpetas con resguardos estrictos:
 * - Nunca borra raíces del sistema (`/`, `C:\`) ni carpetas raíz del usuario (`home`, `desktop`, `documents`, `downloads`).
 * - Valida `allowedDirectories` sobre la ruta y, si es enlace simbólico, borra solo el enlace sin seguirlo hacia afuera.
 * - Si es carpeta no vacía, exige `recursive: true` explícito.
 * - Con `permanent: false` (por defecto) delega en `trashHandler` (en Windows envía a la Papelera de reciclaje
 *   mediante `Microsoft.VisualBasic.FileIO.FileSystem` pasando la ruta por variable de entorno); si no hay
 *   papelera disponible en la plataforma y no se pidió `permanent: true`, falla de forma explícita sin borrar en silencio.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import type { UserEnvironment } from "../../core/environment.ts";
import { isProtectedUserOrSystemRoot, resolveExistingPath } from "../../core/tools/filePaths.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_DELETE_TIMEOUT_MS = 15_000;

export type TrashHandler = (params: {
  readonly targetPath: string;
  readonly isDirectory: boolean;
  readonly signal?: AbortSignal;
}) => Promise<void>;

export interface DeleteFileDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly platform?: NodeJS.Platform;
  readonly trashHandler?: TrashHandler;
  readonly defaultTimeoutMs?: number;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", truncated: false } });

const PS_SEND_TO_TRASH_SCRIPT = [
  "Add-Type -AssemblyName Microsoft.VisualBasic",
  "$p = $env:JARVIS_DELETE_PATH",
  "$ui = [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs",
  "$rec = [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin",
  "if ($env:JARVIS_DELETE_KIND -eq 'dir') {",
  "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, $ui, $rec)",
  "} else {",
  "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, $ui, $rec)",
  "}",
].join("; ");

export function createDefaultTrashHandler(
  platform: NodeJS.Platform = process.platform,
  timeoutMs = DEFAULT_DELETE_TIMEOUT_MS,
): TrashHandler {
  return async ({ targetPath, isDirectory, signal }) => {
    if (platform !== "win32") {
      throw new Error(
        `Recycle Bin requires Windows (current platform: ${platform}). Pass permanent: true to delete directly.`,
      );
    }
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_SEND_TO_TRASH_SCRIPT], {
      timeout: timeoutMs,
      windowsHide: true,
      signal,
      env: {
        ...process.env,
        JARVIS_DELETE_PATH: targetPath,
        JARVIS_DELETE_KIND: isDirectory ? "dir" : "file",
      },
    });
  };
}

export async function runDeleteFile(
  rawArgs: Record<string, unknown>,
  deps: DeleteFileDeps,
  options: { readonly signal?: AbortSignal } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  if (typeof rawArgs.path !== "string" || rawArgs.path.trim() === "") {
    return fail("'path' is required: existing file or folder path to delete.");
  }

  let recursive = false;
  if (rawArgs.recursive !== undefined && rawArgs.recursive !== null) {
    if (typeof rawArgs.recursive !== "boolean") return fail("'recursive' must be true or false.");
    recursive = rawArgs.recursive;
  }

  let permanent = false;
  if (rawArgs.permanent !== undefined && rawArgs.permanent !== null) {
    if (typeof rawArgs.permanent !== "boolean") return fail("'permanent' must be true or false.");
    permanent = rawArgs.permanent;
  }

  // No seguimos symlinks en la comprobación: borrar un symlink dentro de allowedDirectories solo quita el enlace.
  const resolved = await resolveExistingPath(rawArgs.path, deps.getEnvironment, deps.getAllowedDirectories(), {
    expectedKind: "any",
    followSymlinkForAllowedCheck: false,
    paramName: "path",
  });
  if (!resolved.ok) {
    return fail(resolved.message, {
      ...(resolved.denied ? { reason: "denied" } : resolved.notFound ? { reason: "not_found" } : {}),
    });
  }
  if (options.signal?.aborted) return cancelledResult();

  const { targetPath, isDirectory, isSymlink, env } = resolved;

  if (isProtectedUserOrSystemRoot(targetPath, env)) {
    return fail(`[DENIED] Refusing to delete protected system or user root folder '${targetPath}'.`, {
      reason: "denied",
    });
  }

  if (isDirectory && !isSymlink) {
    try {
      const children = await fs.promises.readdir(targetPath);
      if (children.length > 0 && !recursive) {
        return fail(`Folder '${targetPath}' is not empty (${children.length} item(s)). Pass recursive: true to delete it.`, {
          reason: "directory_not_empty",
        });
      }
    } catch (error) {
      return fail(`Cannot inspect folder '${targetPath}': ${errorMessage(error)}`);
    }
  }

  if (options.signal?.aborted) return cancelledResult();

  if (!permanent && !isSymlink) {
    const handler =
      deps.trashHandler ??
      createDefaultTrashHandler(deps.platform ?? process.platform, deps.defaultTimeoutMs ?? DEFAULT_DELETE_TIMEOUT_MS);
    try {
      await handler({ targetPath, isDirectory, signal: options.signal });
      const text = `status: ok · moved ${isDirectory ? "folder" : "file"} to Recycle Bin: ${targetPath}`;
      return toolResult({
        text,
        raw: text,
        data: {
          state: "ok",
          path: targetPath,
          kind: isDirectory ? "directory" : "file",
          mode: "trash",
          truncated: false,
        },
      });
    } catch (error) {
      if (options.signal?.aborted) return cancelledResult();
      return fail(`Cannot move '${targetPath}' to Recycle Bin: ${errorMessage(error)}`);
    }
  }

  try {
    if (isSymlink) {
      await fs.promises.unlink(targetPath);
    } else {
      await fs.promises.rm(targetPath, { recursive: isDirectory && recursive, force: false });
    }
    const text = `status: ok · permanently deleted ${isSymlink ? "symlink" : isDirectory ? "folder" : "file"}: ${targetPath}`;
    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        path: targetPath,
        kind: isSymlink ? "symlink" : isDirectory ? "directory" : "file",
        mode: "permanent",
        truncated: false,
      },
    });
  } catch (error) {
    return fail(`Cannot delete '${targetPath}': ${errorMessage(error)}`);
  }
}
