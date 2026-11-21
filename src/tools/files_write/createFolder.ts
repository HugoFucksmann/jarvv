/**
 * `jarvis_files_write`: herramienta `create_folder`.
 *
 * Crea una carpeta (incluyendo intermedias si hacen falta), valida `allowedDirectories`
 * y comprueba que no exista ya un archivo regular en esa ruta.
 */

import fs from "node:fs";
import type { UserEnvironment } from "../../core/environment.ts";
import { resolvePathTarget } from "../../core/tools/filePaths.ts";
import { cancelledResult, toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

export interface CreateFolderDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

export async function runCreateFolder(
  rawArgs: Record<string, unknown>,
  deps: CreateFolderDeps,
  options: { readonly signal?: AbortSignal } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  if (typeof rawArgs.path !== "string" || rawArgs.path.trim() === "") {
    return fail("'path' is required: absolute folder path or ~ relative path.");
  }

  const resolved = await resolvePathTarget(rawArgs.path, deps.getEnvironment, deps.getAllowedDirectories(), {
    allowEmptyAsHome: false,
    paramName: "path",
  });
  if (!resolved.ok) {
    return fail(resolved.message, resolved.denied ? { reason: "denied" } : {});
  }
  if (options.signal?.aborted) return cancelledResult();

  const { targetPath } = resolved;

  try {
    const existing = await fs.promises.stat(targetPath);
    if (existing.isDirectory()) {
      const text = `status: ok · folder already exists: ${targetPath}`;
      return toolResult({
        text,
        raw: text,
        data: { state: "ok", created: false, alreadyExisted: true, path: targetPath, truncated: false },
      });
    }
    return fail(`Cannot create folder '${targetPath}': a file already exists at that path.`, {
      reason: "path_is_file",
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      return fail(`Cannot inspect '${targetPath}': ${errorMessage(error)}`);
    }
  }

  if (options.signal?.aborted) return cancelledResult();

  try {
    await fs.promises.mkdir(targetPath, { recursive: true });
    const text = `status: ok · created folder: ${targetPath}`;
    return toolResult({
      text,
      raw: text,
      data: { state: "ok", created: true, alreadyExisted: false, path: targetPath, truncated: false },
    });
  } catch (error) {
    return fail(`Cannot create folder '${targetPath}': ${errorMessage(error)}`);
  }
}
