/**
 * `jarvis_files_read`: herramienta `list_folder`.
 *
 * Lista una carpeta conocida o ruta absoluta con tipo, tamaño y fecha de modificación.
 * Permite ordenar (`name`, `size`, `modified`), filtrar por tipo y extensiones, y recorrer hasta profundidad 3.
 * En `raw` conserva el tamaño exacto en bytes; en `text` muestra tamaños legibles y respeta el presupuesto.
 */

import fs from "node:fs";
import path from "node:path";
import type { UserEnvironment } from "../../core/environment.ts";
import { BUDGET } from "../../core/budget.ts";
import { omissionMarker } from "../../core/text.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";
import {
  effectiveTimeoutMs,
  formatLocalDateTime,
  fitLinesToBudget,
  formatSize,
  isCanonicalDescendant,
  joinEntryPath,
  resolveFolderPath,
  yieldEventLoop,
} from "../../core/tools/filePaths.ts";

export const DEFAULT_LIST_TIMEOUT_MS = 8_000;
export const DEFAULT_LIST_DEPTH = 1;
export const MAX_LIST_DEPTH = 3;
export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;

const VALID_SORT_BY = ["name", "size", "modified"] as const;
const VALID_ORDER = ["asc", "desc"] as const;
const VALID_TYPES = ["file", "folder", "any"] as const;

type SortBy = (typeof VALID_SORT_BY)[number];
type SortOrder = (typeof VALID_ORDER)[number];
type EntryTypeFilter = (typeof VALID_TYPES)[number];

const YIELD_EVERY_ENTRIES = 64;

export interface ListFolderDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly now: () => number;
  readonly defaultTimeoutMs: number;
}

interface ParsedListArgs {
  readonly path: string;
  readonly sortBy: SortBy;
  readonly order: SortOrder;
  readonly type: EntryTypeFilter;
  readonly extensions: readonly string[];
  readonly depth: number;
  readonly limit: number;
  readonly includeHidden: boolean;
}

interface FolderEntry {
  readonly name: string;
  readonly relPath: string;
  readonly isDir: boolean;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ext: string;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

function parseArgs(raw: Record<string, unknown>): { readonly ok: true; readonly args: ParsedListArgs } | { readonly ok: false; readonly message: string } {
  if (typeof raw.path !== "string" || raw.path.trim() === "") {
    return { ok: false, message: "'path' is required: a folder path or alias (home, desktop, documents, downloads)." };
  }

  let sortBy: SortBy = "name";
  if (raw.sortBy !== undefined && raw.sortBy !== null) {
    if (typeof raw.sortBy !== "string" || !(VALID_SORT_BY as readonly string[]).includes(raw.sortBy)) {
      return { ok: false, message: `'sortBy' must be one of: ${VALID_SORT_BY.join(", ")}.` };
    }
    sortBy = raw.sortBy as SortBy;
  }

  let order: SortOrder = sortBy === "name" ? "asc" : "desc";
  if (raw.order !== undefined && raw.order !== null) {
    if (typeof raw.order !== "string" || !(VALID_ORDER as readonly string[]).includes(raw.order)) {
      return { ok: false, message: `'order' must be one of: ${VALID_ORDER.join(", ")}.` };
    }
    order = raw.order as SortOrder;
  }

  let typeArg: EntryTypeFilter = "any";
  if (raw.type !== undefined && raw.type !== null) {
    if (typeof raw.type !== "string" || !(VALID_TYPES as readonly string[]).includes(raw.type)) {
      return { ok: false, message: `'type' must be one of: ${VALID_TYPES.join(", ")}.` };
    }
    typeArg = raw.type as EntryTypeFilter;
  }

  let extensions: string[] = [];
  if (raw.extensions !== undefined && raw.extensions !== null) {
    if (!Array.isArray(raw.extensions) || raw.extensions.some((e) => typeof e !== "string")) {
      return { ok: false, message: "'extensions' must be a list of file extensions (e.g. [\"csv\", \"json\"])." };
    }
    extensions = (raw.extensions as string[])
      .map((e) => e.trim().replace(/^\.+/, "").toLowerCase())
      .filter((e) => e !== "");
  }

  let depth = DEFAULT_LIST_DEPTH;
  if (raw.depth !== undefined && raw.depth !== null) {
    if (typeof raw.depth !== "number" || !Number.isInteger(raw.depth) || raw.depth < 1) {
      return { ok: false, message: `'depth' must be an integer >= 1 (max ${MAX_LIST_DEPTH}).` };
    }
    depth = Math.min(raw.depth, MAX_LIST_DEPTH);
  }

  let limit = DEFAULT_LIST_LIMIT;
  if (raw.limit !== undefined && raw.limit !== null) {
    if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1) {
      return { ok: false, message: `'limit' must be a positive integer (max ${MAX_LIST_LIMIT}).` };
    }
    limit = Math.min(raw.limit, MAX_LIST_LIMIT);
  }

  let includeHidden = false;
  if (raw.includeHidden !== undefined && raw.includeHidden !== null) {
    if (typeof raw.includeHidden !== "boolean") {
      return { ok: false, message: "'includeHidden' must be true or false." };
    }
    includeHidden = raw.includeHidden;
  }

  return {
    ok: true,
    args: {
      path: raw.path.trim(),
      sortBy,
      order,
      type: typeArg,
      extensions,
      depth,
      limit,
      includeHidden,
    },
  };
}

function compareEntries(a: FolderEntry, b: FolderEntry, sortBy: SortBy, order: SortOrder): number {
  const dir = order === "asc" ? 1 : -1;
  const byName = a.relPath.toLowerCase().localeCompare(b.relPath.toLowerCase());
  if (sortBy === "name") return byName * dir;
  if (sortBy === "size") return (a.size - b.size) * dir || byName;
  return (a.mtimeMs - b.mtimeMs) * dir || byName;
}

function formatTextLine(entry: FolderEntry, multiDepth: boolean): string {
  const label = multiDepth ? entry.relPath : entry.name;
  const date = formatLocalDateTime(entry.mtimeMs);
  return entry.isDir
    ? `[DIR]  ${label}  —  ${date}`
    : `[FILE] ${label}  ${formatSize(entry.size)}  —  ${date}`;
}

function formatRawLine(entry: FolderEntry, multiDepth: boolean): string {
  const label = multiDepth ? entry.relPath : entry.name;
  const date = formatLocalDateTime(entry.mtimeMs);
  return entry.isDir
    ? `[DIR]  ${label}  —  ${date}`
    : `[FILE] ${label}  ${entry.size} B (${formatSize(entry.size)})  —  ${date}`;
}

const cancelledResult = (): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", count: 0, shown: 0, truncated: false, total: 0 } });

type EntryInfo =
  | { readonly kind: "entry"; readonly isDir: boolean; readonly isFile: boolean; readonly size: number; readonly mtimeMs: number; readonly realTarget: string | undefined }
  | { readonly kind: "skipped" };

const SKIPPED_ENTRY: EntryInfo = { kind: "skipped" };

/** Tipo, tamaño y fecha de una entrada. Un enlace que sale de `realRoot` se omite; uno roto se muestra como archivo; lo ilegible se omite. */
async function statEntry(dirent: fs.Dirent, fullPath: string, realRoot: string): Promise<EntryInfo> {
  if (!dirent.isSymbolicLink()) {
    try {
      const st = await fs.promises.stat(fullPath);
      const isDir = st.isDirectory();
      return { kind: "entry", isDir, isFile: st.isFile(), size: isDir ? 0 : st.size, mtimeMs: st.mtimeMs, realTarget: undefined };
    } catch {
      return SKIPPED_ENTRY;
    }
  }

  try {
    const realTarget = await fs.promises.realpath(fullPath);
    if (!isCanonicalDescendant(realRoot, realTarget)) return SKIPPED_ENTRY;
    const st = await fs.promises.stat(realTarget);
    const isDir = st.isDirectory();
    return { kind: "entry", isDir, isFile: st.isFile(), size: isDir ? 0 : st.size, mtimeMs: st.mtimeMs, realTarget };
  } catch {
    // Enlace simbólico roto o inaccesible: se intenta lstat o se omite sin fallar.
    try {
      const lst = await fs.promises.lstat(fullPath);
      return { kind: "entry", isDir: false, isFile: true, size: 0, mtimeMs: lst.mtimeMs, realTarget: undefined };
    } catch {
      return SKIPPED_ENTRY;
    }
  }
}

interface ListingContext {
  readonly targetPath: string;
  /** Entradas que había antes de aplicar los filtros de tipo y extensión. */
  readonly rawCount: number;
  readonly skipped: number;
}

/** El resultado: ordena, recorta al `limit` y al presupuesto de texto, y deja el listado completo (con bytes exactos) en `raw`. */
function renderListing(entries: FolderEntry[], args: ParsedListArgs, ctx: ListingContext): MCPCallResult {
  const { targetPath, rawCount, skipped } = ctx;
  entries.sort((a, b) => compareEntries(a, b, args.sortBy, args.order));
  const total = entries.length;

  if (total === 0) {
    const emptyText = rawCount === 0 ? "Folder is empty." : "No entries match the filter.";
    return toolResult({
      text: emptyText,
      raw: emptyText,
      data: { state: "ok", count: 0, shown: 0, truncated: false, total: 0, ...(skipped > 0 ? { skipped } : {}) },
      meta: { path: targetPath, depth: args.depth, rawCount, skipped },
    });
  }

  const limited = entries.slice(0, args.limit);
  const multiDepth = args.depth > 1;
  const textBodyLines = limited.map((e) => formatTextLine(e, multiDepth));
  const rawBodyLines = entries.map((e) => formatRawLine(e, multiDepth));

  const prelimHeader = `status: ok · showing ${limited.length} of ${total} (sorted by ${args.sortBy} ${args.order})`;
  const shownTextLines = fitLinesToBudget(prelimHeader, textBodyLines, BUDGET.summaryMax).shown;
  const shown = shownTextLines.length;
  const truncated = shown < total;

  const sortSuffix = args.sortBy !== "name" || args.order !== "asc" ? `, sorted by ${args.sortBy} ${args.order}` : "";
  const header =
    shown === total
      ? `status: ok · ${total} ${total === 1 ? "entry" : "entries"} (showing ${shown}${sortSuffix})`
      : `status: ok · showing ${shown} of ${total} (sorted by ${args.sortBy} ${args.order})`;

  const omittedFromText = total - shown;
  const finalTextLines = [
    header,
    ...shownTextLines,
    ...(omittedFromText > 0 ? [omissionMarker(omittedFromText, "entradas")] : []),
  ];
  const rawHeader = `status: ok · ${total} ${total === 1 ? "entry" : "entries"} (showing ${total}${sortSuffix})`;

  return toolResult({
    text: finalTextLines.join("\n"),
    raw: [rawHeader, ...rawBodyLines].join("\n"),
    data: {
      state: "ok",
      count: shown,
      shown,
      truncated,
      total,
      ...(skipped > 0 ? { skipped } : {}),
    },
    meta: {
      path: targetPath,
      sortBy: args.sortBy,
      order: args.order,
      depth: args.depth,
      limit: args.limit,
      rawCount,
      skipped,
    },
  });
}

export async function runListFolder(
  rawArgs: Record<string, unknown>,
  deps: ListFolderDeps,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  const parsed = parseArgs(rawArgs);
  if (!parsed.ok) return fail(parsed.message);
  const args = parsed.args;

  const resolved = await resolveFolderPath(args.path, deps.getEnvironment, deps.getAllowedDirectories());
  if (!resolved.ok) return fail(resolved.message, resolved.denied ? { reason: "denied" } : {});
  if (options.signal?.aborted) return cancelledResult();

  const { targetPath, realRoot } = resolved;
  const deadline = deps.now() + effectiveTimeoutMs(deps.defaultTimeoutMs, options.timeoutMs);

  const visitedDirs = new Set<string>([realRoot]);
  const queue: Array<{ readonly dirPath: string; readonly relPrefix: string; readonly depth: number }> = [
    { dirPath: targetPath, relPrefix: "", depth: 1 },
  ];

  const entries: FolderEntry[] = [];
  let rawCount = 0;
  let skipped = 0;
  let seen = 0;

  for (let qi = 0; qi < queue.length; qi++) {
    if (options.signal?.aborted) return cancelledResult();
    if (deps.now() >= deadline) {
      return fail(`Listing folder '${targetPath}' exceeded the time limit.`, { reason: "timeout" });
    }

    const current = queue[qi];
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = await fs.promises.readdir(current.dirPath, { withFileTypes: true });
    } catch (error) {
      if (qi === 0) {
        return fail(`Cannot read folder '${targetPath}': ${errorMessage(error)}`);
      }
      skipped++;
      continue;
    }

    for (const dirent of dirEntries) {
      if (options.signal?.aborted) return cancelledResult();
      seen++;
      if (seen % YIELD_EVERY_ENTRIES === 0) await yieldEventLoop();

      if (!args.includeHidden && dirent.name.startsWith(".")) continue;

      const fullPath = joinEntryPath(current.dirPath, dirent.name);
      const relPath = current.relPrefix === "" ? dirent.name : `${current.relPrefix}/${dirent.name}`;
      const info = await statEntry(dirent, fullPath, realRoot);
      if (info.kind === "skipped") {
        skipped++;
        continue;
      }
      const { isDir, isFile, size, mtimeMs, realTarget } = info;
      if (!isDir && !isFile) continue;
      rawCount++;

      const ext = isFile ? path.extname(dirent.name).replace(/^\./, "").toLowerCase() : "";
      const passesType = args.type === "any" || (args.type === "folder" && isDir) || (args.type === "file" && isFile);
      const passesExt = args.extensions.length === 0 || (isFile && args.extensions.includes(ext));
      if (passesType && passesExt) entries.push({ name: dirent.name, relPath, isDir, size, mtimeMs, ext });

      if (isDir && current.depth < args.depth) {
        if (realTarget === undefined) {
          queue.push({ dirPath: fullPath, relPrefix: relPath, depth: current.depth + 1 });
        } else if (!visitedDirs.has(realTarget)) {
          visitedDirs.add(realTarget);
          queue.push({ dirPath: fullPath, relPrefix: relPath, depth: current.depth + 1 });
        }
      }
    }
  }

  return renderListing(entries, args, { targetPath, rawCount, skipped });
}
