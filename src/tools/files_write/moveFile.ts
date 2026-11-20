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
  isCanonicalDescendant,
  isCanonicalWithinAllowedDirs,
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

  let dstExists = false;
  try {
    const dstLst = await fs.promises.lstat(dstResolved.targetPath);
    dstExists = true;
    if (dstLst.isSymbolicLink()) {
      const realDst = await fs.promises.realpath(dstResolved.targetPath);
      if (!isCanonicalWithinAllowedDirs(realDst, allowedDirs, dstResolved.env.home)) {
        return {
          source: srcResolved.targetPath,
          destination: dstResolved.targetPath,
          status: "failed",
          message: `[DENIED] Destination symlink '${dstResolved.targetPath}' points outside allowedDirectories.`,
        };
      }
    }
    if (!overwrite) {
      return {
        source: srcResolved.targetPath,
        destination: dstResolved.targetPath,
        status: "failed",
        message: `Destination already exists: '${dstResolved.targetPath}'. Pass overwrite: true to replace.`,
      };
    }
    const dstStat = await fs.promises.stat(dstResolved.targetPath);
    if (dstStat.isDirectory() !== srcResolved.isDirectory) {
      return {
        source: srcResolved.targetPath,
        destination: dstResolved.targetPath,
        status: "failed",
        message: `Cannot overwrite ${dstStat.isDirectory() ? "folder" : "file"} with a ${srcResolved.isDirectory ? "folder" : "file"}.`,
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { source: srcResolved.targetPath, destination: dstResolved.targetPath, status: "failed", message: errorMessage(error) };
    }
  }

  if (signal?.aborted) {
    return { source: srcResolved.targetPath, destination: dstResolved.targetPath, status: "failed", message: "cancelled" };
  }

  if (dstExists && overwrite && srcResolved.isDirectory) {
    await fs.promises.rm(dstResolved.targetPath, { recursive: true, force: false });
  }

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
  const limitMs =
    options.timeoutMs !== undefined
      ? Math.min(timeoutMs, Math.max(options.timeoutMs > 2_000 ? options.timeoutMs - 1_500 : options.timeoutMs, 1))
      : timeoutMs;
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
