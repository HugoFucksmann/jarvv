/**
 * `jarvis_files_read`: herramienta `find_files`.
 *
 * Búsqueda asíncrona en una sola llamada por nombre de archivo o carpeta:
 * - Recorre en anchura (BFS) respetando plazo, profundidad máxima, tope de entradas y señal de cancelación.
 * - No sigue enlaces simbólicos ni uniones que salgan de la carpeta pedida (los cuenta en `skipped`).
 * - Omite carpetas ilegibles sin fallar (`skipped`) y excluye carpetas ruidosas salvo que el usuario las pida como raíz.
 * - Distingue de forma honesta `found`, `partial`, `no_results` (solo si el recorrido fue completo) e `incomplete`.
 */

import fs from "node:fs";
import type { UserEnvironment } from "../../core/environment.ts";
import { BUDGET } from "../../core/budget.ts";
import { omissionMarker } from "../../core/text.ts";
import { toolResult, toolFail as fail } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { effectiveTimeoutMs, formatSize, resolveFolderPath, fitLinesToBudget } from "../../core/tools/filePaths.ts";
import { settle, walkFolder } from "../../core/tools/walkFolder.ts";
import { matchName, parsePattern, type MatchRank } from "../../core/tools/globPattern.ts";

export const DEFAULT_FIND_TIMEOUT_MS = 8_000;
export const DEFAULT_FIND_MAX_DEPTH = 10;
export const DEFAULT_FIND_MAX_ENTRIES = 100_000;
export const DEFAULT_FIND_MAX_RESULTS = 50;
export const MAX_FIND_RESULTS = 200;

const VALID_TYPES = ["file", "folder", "any"] as const;
type EntryTypeFilter = (typeof VALID_TYPES)[number];
type StoppedBy = "time" | "entries" | "depth";
type FindState = "found" | "partial" | "no_results" | "incomplete" | "cancelled";


interface FindFilesDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly now: () => number;
  readonly defaultTimeoutMs: number;
  readonly maxDepth: number;
  readonly maxEntries: number;
}

interface ParsedFindArgs {
  readonly pattern: string;
  readonly path?: string;
  readonly type: EntryTypeFilter;
  readonly maxResults: number;
}

interface FindMatch {
  readonly path: string;
  readonly name: string;
  readonly isDir: boolean;
  readonly size: number;
  readonly depth: number;
  readonly rank: MatchRank;
}

function parseArgs(raw: Record<string, unknown>): { readonly ok: true; readonly args: ParsedFindArgs } | { readonly ok: false; readonly message: string } {
  if (typeof raw.pattern !== "string" || raw.pattern.trim() === "") {
    return { ok: false, message: "'pattern' is required: name or wildcard pattern (e.g. '*.csv')." };
  }

  let pathArg: string | undefined;
  if (raw.path !== undefined && raw.path !== null) {
    if (typeof raw.path !== "string") return { ok: false, message: "'path' must be a text." };
    if (raw.path.trim() !== "") pathArg = raw.path.trim();
  }

  let typeArg: EntryTypeFilter = "any";
  if (raw.type !== undefined && raw.type !== null) {
    if (typeof raw.type !== "string" || !(VALID_TYPES as readonly string[]).includes(raw.type)) {
      return { ok: false, message: `'type' must be one of: ${VALID_TYPES.join(", ")}.` };
    }
    typeArg = raw.type as EntryTypeFilter;
  }

  let maxResults = DEFAULT_FIND_MAX_RESULTS;
  if (raw.maxResults !== undefined && raw.maxResults !== null) {
    if (typeof raw.maxResults !== "number" || !Number.isInteger(raw.maxResults) || raw.maxResults < 1) {
      return { ok: false, message: `'maxResults' must be a positive integer (max ${MAX_FIND_RESULTS}).` };
    }
    maxResults = Math.min(raw.maxResults, MAX_FIND_RESULTS);
  }

  return { ok: true, args: { pattern: raw.pattern, path: pathArg, type: typeArg, maxResults } };
}

function formatMatchLine(m: FindMatch): string {
  return m.isDir ? `[DIR]  ${m.path}` : `[FILE] ${m.path} (${formatSize(m.size)})`;
}

export async function runFindFiles(
  rawArgs: Record<string, unknown>,
  deps: FindFilesDeps,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) {
    return toolResult({
      text: "status: cancelled",
      raw: "",
      data: { state: "cancelled", count: 0, complete: false, scanned: 0, skipped: 0, truncated: false },
    });
  }

  const parsed = parseArgs(rawArgs);
  if (!parsed.ok) return fail(parsed.message);
  const patternParsed = parsePattern(parsed.args.pattern);
  if (!patternParsed.ok) return fail(patternParsed.message);

  const resolved = await resolveFolderPath(parsed.args.path, deps.getEnvironment, deps.getAllowedDirectories());
  if (!resolved.ok) return fail(resolved.message, resolved.denied ? { reason: "denied" } : {});
  if (options.signal?.aborted) {
    return toolResult({
      text: "status: cancelled",
      raw: "",
      data: { state: "cancelled", count: 0, complete: false, scanned: 0, skipped: 0, truncated: false },
    });
  }

  const { targetPath, realRoot } = resolved;
  const { matchers } = patternParsed;
  const { type: wantType, maxResults } = parsed.args;

  const limitMs = effectiveTimeoutMs(deps.defaultTimeoutMs, options.timeoutMs);
  const startedAt = deps.now();
  const deadline = startedAt + limitMs;

  const walk = walkFolder({
    root: targetPath,
    realRoot,
    maxDepth: deps.maxDepth,
    maxEntries: deps.maxEntries,
    deadline,
    now: deps.now,
    signal: options.signal,
  });
  const buckets: [FindMatch[], FindMatch[], FindMatch[]] = [[], [], []];
  let totalMatches = 0;
  let cancelled = false;

  for await (const entry of walk.entries) {
    const typeMatches = wantType === "any" || (wantType === "folder" && entry.isDir) || (wantType === "file" && entry.isFile);
    if (!typeMatches) continue;
    const rank = matchName(entry.name, matchers);
    if (rank === null) continue;

    // El tamaño solo se pide de lo que coincide (el recorrido no hace un `stat` por archivo).
    let size = entry.size ?? 0;
    if (entry.isFile && entry.size === undefined) {
      const info = await settle(fs.promises.stat(entry.path), options.signal);
      if (info.status === "aborted") {
        cancelled = true;
        break;
      }
      if (info.status === "ok") size = info.value.size;
    }
    totalMatches++;
    if (buckets[rank].length < maxResults) {
      buckets[rank].push({ path: entry.path, name: entry.name, isDir: entry.isDir, size, depth: entry.depth, rank });
    }
  }

  const { seen: scanned, skipped, hitDepthLimit } = walk.state;
  cancelled ||= walk.state.cancelled;
  let stoppedBy: StoppedBy | undefined = walk.state.stoppedBy;

  const cancelledResult = (): MCPCallResult =>
    toolResult({
      text: "status: cancelled",
      raw: "",
      data: { state: "cancelled", count: 0, complete: false, scanned, skipped, truncated: false },
    });

  if (cancelled) return cancelledResult();
  if (stoppedBy === undefined && hitDepthLimit) stoppedBy = "depth";

  const matches = [...buckets[0], ...buckets[1], ...buckets[2]].slice(0, maxResults);
  const complete = stoppedBy === undefined;
  const state: Exclude<FindState, "cancelled"> =
    matches.length > 0 ? (complete ? "found" : "partial") : complete ? "no_results" : "incomplete";

  const countWord = matches.length === 1 ? "match" : "matches";
  const entryWord = scanned === 1 ? "entry" : "entries";

  let header: string;
  switch (state) {
    case "found":
      header = `status: found · ${matches.length} ${countWord} · complete`;
      break;
    case "partial":
      header = `status: partial · ${matches.length} ${countWord} · stopped by ${stoppedBy} (incomplete): narrow the path`;
      break;
    case "no_results":
      header = `status: no_results · searched ${scanned} ${entryWord} in ${targetPath} · complete`;
      break;
    case "incomplete":
      header = `status: incomplete · 0 matches · stopped by ${stoppedBy}: not a "not found"; narrow the path`;
      break;
  }

  const allLines = matches.map(formatMatchLine);
  const fitted = fitLinesToBudget(header, allLines, BUDGET.summaryMax);
  const omittedCount = allLines.length - fitted.shown.length;
  const textLines = [header, ...fitted.shown, ...(omittedCount > 0 ? [omissionMarker(omittedCount, "resultados")] : [])];
  const rawLines = [header, ...allLines];

  return toolResult({
    text: textLines.join("\n"),
    raw: rawLines.join("\n"),
    data: {
      state,
      count: matches.length,
      complete,
      scanned,
      skipped,
      ...(stoppedBy === undefined ? {} : { stoppedBy }),
      truncated: fitted.truncated,
      ...(totalMatches > matches.length ? { totalMatches } : {}),
    },
    meta: {
      pattern: parsed.args.pattern,
      path: targetPath,
      type: wantType,
      maxResults,
      durationMs: deps.now() - startedAt,
      totalMatches,
    },
  });
}

