/**
 * `jarvis_files_write`: herramienta `move_file` (mover y renombrar en lote).
 *
 * Acepta `items: Array<{ source, destination }>` (hasta 200 elementos por llamada):
 * - Valida `allowedDirectories` en cada origen y destino.
 * - Impide mover raíces del sistema o carpetas raíz del usuario (`home`, `desktop`, etc.),
 *   mover a la misma ruta o mover una carpeta dentro de sí misma.
 * - Usa `fs.promises.rename` cuando están en el mismo volumen y cae en copia controlada +
 *   borrado del origen cuando el sistema responde `EXDEV`.
 */

import fs from "node:fs";
import type { UserEnvironment } from "../../core/environment.ts";
import { canonicalPath } from "../../core/policy/allowedDirs.ts";
import {
  dirnameOf,
  effectiveTimeoutMs,
  inspectDestinationTarget,
  isCanonicalDescendant,
  isProtectedUserOrSystemRoot,
  resolveExistingPath,
  resolvePathTarget,
} from "../../core/tools/filePaths.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage, isRecord } from "../../core/utils.ts";
import {
  copyPathControlled,
  DEFAULT_COPY_MAX_BYTES,
  DEFAULT_COPY_MAX_ENTRIES,
  DEFAULT_COPY_TIMEOUT_MS,
} from "./copyFile.ts";

export const MAX_MOVE_ITEMS = 200;

export interface MoveFileDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly now: () => number;
  readonly defaultTimeoutMs?: number;
}

interface MoveItemArg {
  readonly source: string;
  readonly destination: string;
}

interface MoveItemOutcome {
  readonly source: string;
  readonly destination: string;
  readonly status: "moved" | "failed";
  readonly message?: string;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (moved: number): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", moved, truncated: false } });

function parseArgs(
  raw: Record<string, unknown>,
):
  | { readonly ok: true; readonly items: readonly MoveItemArg[]; readonly overwrite: boolean }
  | { readonly ok: false; readonly message: string } {
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    return { ok: false, message: "'items' is required and must be a non-empty array of { source, destination }." };
  }
  if (raw.items.length > MAX_MOVE_ITEMS) {
    return { ok: false, message: `'items' supports at most ${MAX_MOVE_ITEMS} entries per call.` };
  }

  const items: MoveItemArg[] = [];
  for (let i = 0; i < raw.items.length; i++) {
    const item = raw.items[i];
    if (!isRecord(item) || typeof item.source !== "string" || item.source.trim() === "" || typeof item.destination !== "string" || item.destination.trim() === "") {
      return { ok: false, message: `items[${i}] must have non-empty string 'source' and 'destination'.` };
    }
    items.push({ source: item.source.trim(), destination: item.destination.trim() });
  }

  let overwrite = false;
  if (raw.overwrite !== undefined && raw.overwrite !== null) {
    if (typeof raw.overwrite !== "boolean") return { ok: false, message: "'overwrite' must be true or false." };
    overwrite = raw.overwrite;
  }

  return { ok: true, items, overwrite };
}

async function moveSingleItem(
  item: MoveItemArg,
  overwrite: boolean,
  deps: MoveFileDeps,
  deadline: number,
  signal?: AbortSignal,
): Promise<MoveItemOutcome> {
  const allowedDirs = deps.getAllowedDirectories();

  const srcResolved = await resolveExistingPath(item.source, deps.getEnvironment, allowedDirs, {
    expectedKind: "any",
    followSymlinkForAllowedCheck: false,
    paramName: "source",
  });
  if (!srcResolved.ok) {
    return { source: item.source, destination: item.destination, status: "failed", message: srcResolved.message };
  }

  if (isProtectedUserOrSystemRoot(srcResolved.targetPath, srcResolved.env)) {
    return {
      source: srcResolved.targetPath,
      destination: item.destination,
      status: "failed",
      message: `[DENIED] Refusing to move protected root folder '${srcResolved.targetPath}'.`,
    };
  }

  const dstResolved = await resolvePathTarget(item.destination, deps.getEnvironment, allowedDirs, {
    allowEmptyAsHome: false,
    paramName: "destination",
  });
  if (!dstResolved.ok) {
    return { source: srcResolved.targetPath, destination: item.destination, status: "failed", message: dstResolved.message };
  }

  const canonicalSrc = canonicalPath(srcResolved.targetPath);
  const canonicalDst = canonicalPath(dstResolved.targetPath);
  if (isCanonicalDescendant(canonicalSrc, canonicalDst) && isCanonicalDescendant(canonicalDst, canonicalSrc)) {
    return {
      source: srcResolved.targetPath,
      destination: dstResolved.targetPath,
      status: "failed",
      message: "Source and destination refer to the same path.",
    };
  }
  if (srcResolved.isDirectory && isCanonicalDescendant(srcResolved.realTarget, canonicalDst)) {
    return {
      source: srcResolved.targetPath,
      destination: dstResolved.targetPath,
      status: "failed",
      message: `Cannot move folder '${srcResolved.targetPath}' into itself or its subfolder.`,
    };
  }

  const parentDir = dirnameOf(dstResolved.targetPath);
  try {
    const parentStat = await fs.promises.stat(parentDir);
    if (!parentStat.isDirectory()) {
      return {
        source: srcResolved.targetPath,
        destination: dstResolved.targetPath,
        status: "failed",
        message: `Destination parent '${parentDir}' is not a folder.`,
      };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      source: srcResolved.targetPath,
      destination: dstResolved.targetPath,
      status: "failed",
      message: code === "ENOENT" ? `Destination parent folder does not exist: '${parentDir}'.` : errorMessage(error),
    };
  }

  const dstInspection = await inspectDestinationTarget(dstResolved.targetPath, allowedDirs, dstResolved.env.home);
  if (dstInspection.status === "denied" || dstInspection.status === "error") {
    return {
      source: srcResolved.targetPath,
      destination: dstResolved.targetPath,
      status: "failed",
      message: dstInspection.message,
    };
  }
  const dstExists = dstInspection.status === "exists";
  if (dstInspection.status === "exists") {
    if (!overwrite) {
      return {
        source: srcResolved.targetPath,
        destination: dstResolved.targetPath,
        status: "failed",
        message: `Destination already exists: '${dstResolved.targetPath}'. Pass overwrite: true to replace.`,
      };
    }
    if (dstInspection.isDirectory !== srcResolved.isDirectory) {
      return {
        source: srcResolved.targetPath,
        destination: dstResolved.targetPath,
        status: "failed",
        message: `Cannot overwrite ${dstInspection.isDirectory ? "folder" : "file"} with a ${srcResolved.isDirectory ? "folder" : "file"}.`,
      };
    }
  }

  if (signal?.aborted) {
    return { source: srcResolved.targetPath, destination: dstResolved.targetPath, status: "failed", message: "cancelled" };
  }

  const performMove = async (): Promise<MoveItemOutcome> => {
    try {
      await fs.promises.rename(srcResolved.targetPath, dstResolved.targetPath);
      return { source: srcResolved.targetPath, destination: dstResolved.targetPath, status: "moved" };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EXDEV") {
        return { source: srcResolved.targetPath, destination: dstResolved.targetPath, status: "failed", message: errorMessage(error) };
      }
    }

    // Fallback entre volúmenes distintos (`EXDEV`): copia controlada + borrado del origen.
    if (srcResolved.isSymlink) {
      const linkTarget = await fs.promises.readlink(srcResolved.targetPath);
      if (dstExists && overwrite) await fs.promises.rm(dstResolved.targetPath, { force: true });
      await fs.promises.symlink(linkTarget, dstResolved.targetPath);
      await fs.promises.unlink(srcResolved.targetPath);
      return { source: srcResolved.targetPath, destination: dstResolved.targetPath, status: "moved" };
    }

    const copied = await copyPathControlled({
      sourcePath: srcResolved.targetPath,
      realSource: srcResolved.realTarget,
      isSourceDir: srcResolved.isDirectory,
      destinationPath: dstResolved.targetPath,
      overwrite,
      allowedDirs,
      home: dstResolved.env.home,
      now: deps.now,
      deadline,
      maxEntries: DEFAULT_COPY_MAX_ENTRIES,
      maxBytes: DEFAULT_COPY_MAX_BYTES,
      signal,
    });
    if (!copied.ok) {
      return { source: srcResolved.targetPath, destination: dstResolved.targetPath, status: "failed", message: copied.message };
    }
    await fs.promises.rm(srcResolved.targetPath, { recursive: srcResolved.isDirectory, force: false });
    return { source: srcResolved.targetPath, destination: dstResolved.targetPath, status: "moved" };
  };

  // Al sobrescribir una carpeta real no se borra el destino por adelantado: se aparta como
  // respaldo y solo se elimina cuando el movimiento termina bien (si falla, se restaura).
  let backupPath: string | null = null;
  const restoreBackup = async (): Promise<void> => {
    if (backupPath === null) return;
    try {
      await fs.promises.rm(dstResolved.targetPath, { recursive: true, force: true });
      await fs.promises.rename(backupPath, dstResolved.targetPath);
      backupPath = null;
    } catch {
      /* no se pudo restaurar: el respaldo queda en disco y se informa abajo */
    }
  };
  const settle = async (result: MoveItemOutcome): Promise<MoveItemOutcome> => {
    if (backupPath === null) return result;
    if (result.status === "moved") {
      try {
        await fs.promises.rm(backupPath, { recursive: true, force: true });
      } catch {
        return { ...result, message: `Moved, but the previous destination backup could not be removed: '${backupPath}'.` };
      }
      return result;
    }
    await restoreBackup();
    if (backupPath !== null) {
      return { ...result, message: `${result.message ?? "failed"} (the previous destination was kept at '${backupPath}')` };
    }
    return result;
  };

  try {
    if (dstInspection.status === "exists" && overwrite && srcResolved.isDirectory) {
      if (dstInspection.isSymlink) {
        await fs.promises.unlink(dstResolved.targetPath);
      } else {
        backupPath = `${dstResolved.targetPath}.jarvis-bak-${process.pid}-${Date.now()}`;
        await fs.promises.rename(dstResolved.targetPath, backupPath);
      }
    }
    return await settle(await performMove());
  } catch (error) {
    return settle({
      source: srcResolved.targetPath,
      destination: dstResolved.targetPath,
      status: "failed",
      message: errorMessage(error),
    });
  }
}

export async function runMoveFile(
  rawArgs: Record<string, unknown>,
  deps: MoveFileDeps,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult(0);

  const parsed = parseArgs(rawArgs);
  if (!parsed.ok) return fail(parsed.message);

  const timeoutMs = deps.defaultTimeoutMs ?? DEFAULT_COPY_TIMEOUT_MS;
  const limitMs = effectiveTimeoutMs(timeoutMs, options.timeoutMs);
  const deadline = deps.now() + limitMs;

  const outcomes: MoveItemOutcome[] = [];
  let moved = 0;

  for (const item of parsed.items) {
    if (options.signal?.aborted) return cancelledResult(moved);
    const outcome = await moveSingleItem(item, parsed.overwrite, deps, deadline, options.signal);
    if (options.signal?.aborted) return cancelledResult(moved);
    outcomes.push(outcome);
    if (outcome.status === "moved") moved++;
  }

  const failed = outcomes.length - moved;
  const lines = outcomes.map((o) =>
    o.status === "moved"
      ? `[MOVED]  ${o.source} -> ${o.destination}`
      : `[FAILED] ${o.source} -> ${o.destination}: ${o.message ?? "unknown error"}`,
  );
  const header = `status: ${failed === 0 ? "ok" : moved > 0 ? "partial" : "error"} · moved ${moved} of ${outcomes.length} item(s)`;
  const text = [header, ...lines].join("\n");

  return toolResult({
    text,
    raw: text,
    isError: moved === 0 && failed > 0,
    data: {
      state: failed === 0 ? "ok" : moved > 0 ? "partial" : "error",
      moved,
      failed,
      total: outcomes.length,
      items: outcomes,
      truncated: false,
    },
  });
}
