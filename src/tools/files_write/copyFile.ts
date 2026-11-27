/**
 * `jarvis_files_write`: herramienta `copy_file`.
 *
 * Copia archivos y carpetas con garantías de seguridad y rendimiento:
 * - Valida `allowedDirectories` y enlaces simbólicos en origen y destino.
 * - Impide copiar una carpeta dentro de sí misma o de un descendiente.
 * - No sobrescribe salvo `overwrite: true`.
 * - En copias de carpetas aplica recorrido iterativo con límites de entradas, bytes, plazo y `AbortSignal`.
 */

import fs from "node:fs";
import type { UserEnvironment } from "../../core/environment.ts";
import { canonicalPath } from "../../core/policy/allowedDirs.ts";
import {
  dirnameOf,
  effectiveTimeoutMs,
  formatSize,
  inspectDestinationTarget,
  isCanonicalDescendant,
  isCanonicalWithinAllowedDirs,
  joinEntryPath,
  resolveExistingPath,
  resolvePathTarget,
  yieldEventLoop,
  pathFailureData,
} from "../../core/tools/filePaths.ts";
import { cancelledResult, toolResult, toolFail as fail } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

export const DEFAULT_COPY_TIMEOUT_MS = 30_000;
export const DEFAULT_COPY_MAX_ENTRIES = 20_000;
export const DEFAULT_COPY_MAX_BYTES = 512 * 1024 * 1024;
const YIELD_EVERY_ENTRIES = 64;

interface CopyFileDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly now: () => number;
  readonly defaultTimeoutMs: number;
  readonly maxEntries: number;
  readonly maxBytes: number;
}

interface ParsedCopyArgs {
  readonly source: string;
  readonly destination: string;
  readonly overwrite: boolean;
  readonly recursive: boolean;
}

interface CopyTreeResult {
  readonly ok: true;
  readonly filesCopied: number;
  readonly dirsCreated: number;
  readonly bytesCopied: number;
}

type CopyTreeOutcome =
  | CopyTreeResult
  | { readonly ok: false; readonly cancelled?: boolean; readonly denied?: boolean; readonly message: string };

function parseArgs(
  raw: Record<string, unknown>,
): { readonly ok: true; readonly args: ParsedCopyArgs } | { readonly ok: false; readonly message: string } {
  if (typeof raw.source !== "string" || raw.source.trim() === "") {
    return { ok: false, message: "'source' is required: existing file or folder path." };
  }
  if (typeof raw.destination !== "string" || raw.destination.trim() === "") {
    return { ok: false, message: "'destination' is required: destination file or folder path." };
  }

  let overwrite = false;
  if (raw.overwrite !== undefined && raw.overwrite !== null) {
    if (typeof raw.overwrite !== "boolean") return { ok: false, message: "'overwrite' must be true or false." };
    overwrite = raw.overwrite;
  }

  let recursive = true;
  if (raw.recursive !== undefined && raw.recursive !== null) {
    if (typeof raw.recursive !== "boolean") return { ok: false, message: "'recursive' must be true or false." };
    recursive = raw.recursive;
  }

  return {
    ok: true,
    args: {
      source: raw.source.trim(),
      destination: raw.destination.trim(),
      overwrite,
      recursive,
    },
  };
}

/** Copia recursivamente un archivo o árbol controlado con chequeos de symlinks, límites y `AbortSignal`. */
export async function copyPathControlled(params: {
  readonly sourcePath: string;
  readonly realSource: string;
  readonly isSourceDir: boolean;
  readonly destinationPath: string;
  readonly overwrite: boolean;
  readonly allowedDirs: readonly string[];
  readonly home: string;
  readonly now: () => number;
  readonly deadline: number;
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}): Promise<CopyTreeOutcome> {
  const {
    sourcePath,
    realSource,
    isSourceDir,
    destinationPath,
    overwrite,
    allowedDirs,
    home,
    now,
    deadline,
    maxEntries,
    maxBytes,
    signal,
  } = params;

  if (signal?.aborted) return { ok: false, cancelled: true, message: "cancelled" };

  try {
    if (!isSourceDir) {
      let st: fs.Stats;
      try {
        st = await fs.promises.stat(realSource);
      } catch (error) {
        return { ok: false, message: `Cannot read source '${sourcePath}': ${errorMessage(error)}` };
      }
      if (st.size > maxBytes) {
        return { ok: false, message: `Source file '${sourcePath}' exceeds copy size limit (${formatSize(st.size)} > ${formatSize(maxBytes)}).` };
      }
      const mode = overwrite ? 0 : fs.constants.COPYFILE_EXCL;
      await fs.promises.copyFile(realSource, destinationPath, mode);
      return { ok: true, filesCopied: 1, dirsCreated: 0, bytesCopied: st.size };
    }

    const visitedDirs = new Set<string>([realSource]);
    const queue: Array<{ readonly srcDir: string; readonly dstDir: string }> = [
      { srcDir: sourcePath, dstDir: destinationPath },
    ];

    let filesCopied = 0;
    let dirsCreated = 0;
    let bytesCopied = 0;
    let processed = 0;

    await fs.promises.mkdir(destinationPath, { recursive: true });
    dirsCreated++;

    for (let qi = 0; qi < queue.length; qi++) {
      if (signal?.aborted) return { ok: false, cancelled: true, message: "cancelled" };
      if (now() >= deadline) {
        return { ok: false, message: `Copy exceeded time limit after ${filesCopied} file(s).` };
      }

      const { srcDir, dstDir } = queue[qi];
      const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

      for (const entry of entries) {
        if (signal?.aborted) return { ok: false, cancelled: true, message: "cancelled" };
        if (now() >= deadline) {
          return { ok: false, message: `Copy exceeded time limit after ${filesCopied} file(s).` };
        }

        processed++;
        if (processed > maxEntries) {
          return { ok: false, message: `Copy exceeded entry limit (${maxEntries} entries).` };
        }
        if (processed % YIELD_EVERY_ENTRIES === 0) {
          await yieldEventLoop();
        }

        const srcEntry = joinEntryPath(srcDir, entry.name);
        const dstEntry = joinEntryPath(dstDir, entry.name);

        let isDir = entry.isDirectory();
        let isFile = entry.isFile();
        let realEntry = srcEntry;
        let size = 0;

        if (entry.isSymbolicLink()) {
          try {
            realEntry = await fs.promises.realpath(srcEntry);
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            return {
              ok: false,
              message:
                code === "ENOENT" || code === "ENOTDIR"
                  ? `Cannot copy broken symbolic link '${srcEntry}'.`
                  : `Cannot resolve symbolic link '${srcEntry}': ${errorMessage(error)}`,
            };
          }
          if (!isCanonicalDescendant(realSource, realEntry) || !isCanonicalWithinAllowedDirs(realEntry, allowedDirs, home)) {
            return {
              ok: false,
              denied: true,
              message: `[DENIED] Symbolic link '${srcEntry}' points outside source tree or allowedDirectories.`,
            };
          }
          const st = await fs.promises.stat(realEntry);
          isDir = st.isDirectory();
          isFile = st.isFile();
          size = isDir ? 0 : st.size;
        } else if (isFile) {
          const st = await fs.promises.stat(srcEntry);
          size = st.size;
        } else if (!isDir) {
          const st = await fs.promises.stat(srcEntry);
          isDir = st.isDirectory();
          isFile = st.isFile();
          size = isDir ? 0 : st.size;
        }

        if (isDir) {
          if (visitedDirs.has(realEntry)) continue;
          visitedDirs.add(realEntry);
          await fs.promises.mkdir(dstEntry, { recursive: true });
          dirsCreated++;
          queue.push({ srcDir: srcEntry, dstDir: dstEntry });
        } else if (isFile) {
          if (bytesCopied + size > maxBytes) {
            return { ok: false, message: `Copy exceeded total byte limit (${formatSize(maxBytes)}).` };
          }
          const mode = overwrite ? 0 : fs.constants.COPYFILE_EXCL;
          await fs.promises.copyFile(realEntry, dstEntry, mode);
          filesCopied++;
          bytesCopied += size;
        }
      }
    }

    return { ok: true, filesCopied, dirsCreated, bytesCopied };
  } catch (error) {
    if (signal?.aborted) return { ok: false, cancelled: true, message: "cancelled" };
    return { ok: false, message: `Copy failed for '${sourcePath}': ${errorMessage(error)}` };
  }
}

export async function runCopyFile(
  rawArgs: Record<string, unknown>,
  deps: CopyFileDeps,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  const parsed = parseArgs(rawArgs);
  if (!parsed.ok) return fail(parsed.message);
  const args = parsed.args;

  const allowedDirs = deps.getAllowedDirectories();
  const srcResolved = await resolveExistingPath(args.source, deps.getEnvironment, allowedDirs, {
    expectedKind: "any",
    followSymlinkForAllowedCheck: true,
    paramName: "source",
  });
  if (!srcResolved.ok) {
    return fail(srcResolved.message, pathFailureData(srcResolved));
  }

  const dstResolved = await resolvePathTarget(args.destination, deps.getEnvironment, allowedDirs, {
    allowEmptyAsHome: false,
    paramName: "destination",
  });
  if (!dstResolved.ok) {
    return fail(dstResolved.message, dstResolved.denied ? { reason: "denied" } : {});
  }
  if (options.signal?.aborted) return cancelledResult();

  if (srcResolved.isDirectory && !args.recursive) {
    return fail(`'${srcResolved.targetPath}' is a folder; pass recursive: true (default) to copy folders.`, {
      reason: "path_is_directory",
    });
  }

  const canonicalDst = canonicalPath(dstResolved.targetPath);
  if (
    isCanonicalDescendant(srcResolved.realTarget, canonicalDst) &&
    isCanonicalDescendant(canonicalDst, srcResolved.realTarget)
  ) {
    return fail("Source and destination refer to the same path.", { reason: "same_path" });
  }
  if (srcResolved.isDirectory && isCanonicalDescendant(srcResolved.realTarget, canonicalDst)) {
    return fail(`Cannot copy folder '${srcResolved.targetPath}' into itself or its subfolder '${dstResolved.targetPath}'.`, {
      reason: "self_copy",
    });
  }

  const parentDir = dirnameOf(dstResolved.targetPath);
  try {
    const parentStat = await fs.promises.stat(parentDir);
    if (!parentStat.isDirectory()) {
      return fail(`Destination parent '${parentDir}' is not a folder.`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return fail(`Destination parent folder does not exist: '${parentDir}'.`);
    }
    return fail(`Cannot inspect destination parent '${parentDir}': ${errorMessage(error)}`);
  }

  const dstInspection = await inspectDestinationTarget(dstResolved.targetPath, allowedDirs, dstResolved.env.home);
  if (dstInspection.status === "denied") {
    return fail(dstInspection.message, { reason: "denied" });
  }
  if (dstInspection.status === "error") {
    return fail(dstInspection.message);
  }
  if (dstInspection.status === "exists") {
    if (!args.overwrite) {
      return fail(`Destination already exists: '${dstResolved.targetPath}'. Pass overwrite: true to replace.`, {
        reason: "already_exists",
      });
    }
    if (dstInspection.isDirectory !== srcResolved.isDirectory) {
      return fail(
        `Cannot overwrite ${dstInspection.isDirectory ? "folder" : "file"} '${dstResolved.targetPath}' with a ${srcResolved.isDirectory ? "folder" : "file"}.`,
        { reason: "kind_mismatch" },
      );
    }
  }

  const limitMs = effectiveTimeoutMs(deps.defaultTimeoutMs, options.timeoutMs);
  const deadline = deps.now() + limitMs;

  try {
    const outcome = await copyPathControlled({
      sourcePath: srcResolved.targetPath,
      realSource: srcResolved.realTarget,
      isSourceDir: srcResolved.isDirectory,
      destinationPath: dstResolved.targetPath,
      overwrite: args.overwrite,
      allowedDirs,
      home: dstResolved.env.home,
      now: deps.now,
      deadline,
      maxEntries: deps.maxEntries,
      maxBytes: deps.maxBytes,
      signal: options.signal,
    });
    if (!outcome.ok) {
      if (outcome.cancelled) return cancelledResult();
      return fail(outcome.message, outcome.denied ? { reason: "denied" } : {});
    }

    const summary = srcResolved.isDirectory
      ? `status: ok · copied folder ${srcResolved.targetPath} -> ${dstResolved.targetPath} (${outcome.filesCopied} file(s), ${outcome.dirsCreated} folder(s), ${formatSize(outcome.bytesCopied)})`
      : `status: ok · copied file ${srcResolved.targetPath} -> ${dstResolved.targetPath} (${formatSize(outcome.bytesCopied)})`;

    return toolResult({
      text: summary,
      raw: summary,
      data: {
        state: "ok",
        source: srcResolved.targetPath,
        destination: dstResolved.targetPath,
        kind: srcResolved.isDirectory ? "directory" : "file",
        filesCopied: outcome.filesCopied,
        dirsCreated: outcome.dirsCreated,
        bytesCopied: outcome.bytesCopied,
        truncated: false,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    return fail(`Copy failed: ${errorMessage(error)}`);
  }
}
