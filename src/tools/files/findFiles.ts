/**
 * `jarvis_files`: herramienta `find_files`.
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
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import {
  effectiveTimeoutMs,
  fitLinesToBudget,
  formatSize,
  isCanonicalDescendant,
  isExcludedSubdir,
  joinEntryPath,
  raceAbort,
  resolveFolderPath,
  yieldEventLoop,
} from "../../core/tools/filePaths.ts";
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

const YIELD_EVERY_ENTRIES = 64;

export interface FindFilesDeps {
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

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

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

  const visitedDirs = new Set<string>([realRoot]);
  const queue: Array<{ readonly dirPath: string; readonly depth: number }> = [{ dirPath: targetPath, depth: 0 }];
  const buckets: [FindMatch[], FindMatch[], FindMatch[]] = [[], [], []];

  let scanned = 0;
  let skipped = 0;
  let totalMatches = 0;
  let hitDepthLimit = false;
  let stoppedBy: StoppedBy | undefined;
  let cancelled = false;

  const cancelledResult = (): MCPCallResult =>
    toolResult({
      text: "status: cancelled",
      raw: "",
      data: { state: "cancelled", count: 0, complete: false, scanned, skipped, truncated: false },
    });

  for (let qi = 0; qi < queue.length; qi++) {
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }
    if (deps.now() >= deadline) {
      stoppedBy = "time";
      break;
    }

    const current = queue[qi];
    const dirRead = await raceAbort(
      fs.promises.readdir(current.dirPath, { withFileTypes: true }).then(
        (entries) => ({ ok: true as const, entries }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
      options.signal,
    );
    if (dirRead.aborted) {
      cancelled = true;
      break;
    }
    if (!dirRead.value.ok) {
      skipped++;
      continue;
    }

    for (const entry of dirRead.value.entries) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }
      if (deps.now() >= deadline) {
        stoppedBy = "time";
        break;
      }
      if (scanned >= deps.maxEntries) {
        stoppedBy = "entries";
        break;
      }

      scanned++;
      if (scanned % YIELD_EVERY_ENTRIES === 0) {
        await yieldEventLoop();
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }
        if (deps.now() >= deadline) {
          stoppedBy = "time";
          break;
        }
      }

      const fullPath = joinEntryPath(current.dirPath, entry.name);
      let isDir = false;
      let isFile = false;
      let size = 0;
      let hasSize = false;
      let realTarget: string | undefined;

      if (entry.isSymbolicLink()) {
        const targetRes = await raceAbort(
          fs.promises.realpath(fullPath).then(
            (r) => ({ ok: true as const, real: r }),
            () => ({ ok: false as const }),
          ),
          options.signal,
        );
        if (targetRes.aborted) {
          cancelled = true;
          break;
        }
        if (!targetRes.value.ok) {
          skipped++;
          continue;
        }
        realTarget = targetRes.value.real;
        if (!isCanonicalDescendant(realRoot, realTarget)) {
          skipped++;
          continue;
        }
        const statRes = await raceAbort(
          fs.promises.stat(realTarget).then(
            (s) => ({ ok: true as const, stat: s }),
            () => ({ ok: false as const }),
          ),
          options.signal,
        );
        if (statRes.aborted) {
          cancelled = true;
          break;
        }
        if (!statRes.value.ok) {
          skipped++;
          continue;
        }
        isDir = statRes.value.stat.isDirectory();
        isFile = statRes.value.stat.isFile();
        size = isDir ? 0 : statRes.value.stat.size;
        hasSize = true;
      } else {
        isDir = entry.isDirectory();
        isFile = entry.isFile();
        if (isDir && isExcludedSubdir(entry.name, fullPath)) {
          continue;
        }
        if (!isDir && !isFile) {
          // Entrada sin tipo en el dirent o tipo especial (p. ej. socket/FIFO).
          const lstatRes = await raceAbort(
            fs.promises.lstat(fullPath).then(
              (s) => ({ ok: true as const, stat: s }),
              () => ({ ok: false as const }),
            ),
            options.signal,
          );
          if (lstatRes.aborted) {
            cancelled = true;
            break;
          }
          if (!lstatRes.value.ok) {
            skipped++;
            continue;
          }
          isDir = lstatRes.value.stat.isDirectory();
          isFile = lstatRes.value.stat.isFile();
          if (isDir && isExcludedSubdir(entry.name, fullPath)) {
            continue;
          }
          if (!isDir && !isFile) continue;
          size = isDir ? 0 : lstatRes.value.stat.size;
          hasSize = true;
        }
      }

      const typeMatches = wantType === "any" || (wantType === "folder" && isDir) || (wantType === "file" && isFile);
      if (typeMatches) {
        const rank = matchName(entry.name, matchers);
        if (rank !== null) {
          if (isFile && !hasSize) {
            const statRes = await raceAbort(
              fs.promises.stat(fullPath).then(
                (s) => ({ ok: true as const, stat: s }),
                () => ({ ok: false as const }),
              ),
              options.signal,
            );
            if (statRes.aborted) {
              cancelled = true;
              break;
            }
            if (statRes.value.ok) {
              size = statRes.value.stat.size;
            }
          }
          totalMatches++;
          if (buckets[rank].length < maxResults) {
            buckets[rank].push({
              path: fullPath,
              name: entry.name,
              isDir,
              size,
              depth: current.depth + 1,
              rank,
            });
          }
        }
      }

      if (isDir) {
        const nextDepth = current.depth + 1;
        if (nextDepth < deps.maxDepth) {
          if (realTarget !== undefined) {
            if (!visitedDirs.has(realTarget)) {
              visitedDirs.add(realTarget);
              queue.push({ dirPath: fullPath, depth: nextDepth });
            }
          } else {
            queue.push({ dirPath: fullPath, depth: nextDepth });
          }
        } else {
          hitDepthLimit = true;
        }
      }
    }

    if (cancelled || stoppedBy !== undefined) break;
  }

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
