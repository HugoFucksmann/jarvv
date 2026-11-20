/**
 * `jarvis_files_read`: herramienta `search_content`.
 *
 * Busca texto literal o expresión regular dentro de archivos:
 * - Recorre en anchura (BFS) respetando plazo, profundidad máxima, límite de archivos, tamaño por archivo y `AbortSignal`.
 * - Omite binarios (detección de bytes NUL en el primer bloque), carpetas ruidosas (`node_modules`, `.git`, etc.)
 *   y enlaces simbólicos que salen de la carpeta raíz (`isCanonicalDescendant`).
 * - Lee por stream línea por línea cerrando el descriptor inmediatamente en `finally` al alcanzar topes o cancelación.
 */

import fs from "node:fs";
import readline from "node:readline";
import { BUDGET } from "../../core/budget.ts";
import type { UserEnvironment } from "../../core/environment.ts";
import { omissionMarker } from "../../core/text.ts";
import {
  fitLinesToBudget,
  isCanonicalDescendant,
  isExcludedSubdir,
  joinEntryPath,
  raceAbort,
  resolveExistingPath,
  yieldEventLoop,
} from "../../core/tools/filePaths.ts";
import { matchName, parsePattern, type PatternMatcher } from "../../core/tools/globPattern.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

export const DEFAULT_SEARCH_TIMEOUT_MS = 10_000;
export const DEFAULT_SEARCH_MAX_DEPTH = 10;
export const DEFAULT_SEARCH_MAX_FILES = 10_000;
export const DEFAULT_SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_SEARCH_MAX_RESULTS = 50;
export const MAX_SEARCH_RESULTS = 200;
export const DEFAULT_MAX_MATCHES_PER_FILE = 10;
export const MAX_LINE_SNIPPET_CHARS = 220;

const YIELD_EVERY_ENTRIES = 64;
const BINARY_PROBE_BYTES = 8_192;

export interface SearchContentDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly now: () => number;
  readonly defaultTimeoutMs: number;
  readonly maxDepth: number;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
}

interface ParsedSearchArgs {
  readonly query: string;
  readonly path?: string;
  readonly filePattern?: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  readonly maxResults: number;
  readonly maxMatchesPerFile: number;
  readonly includeHidden: boolean;
}

interface ContentMatch {
  readonly filePath: string;
  readonly line: number;
  readonly text: string;
}

type StoppedBy = "time" | "files" | "depth" | "limit";
type SearchState = "found" | "partial" | "no_results" | "incomplete" | "cancelled";

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (scannedFiles = 0, skipped = 0): MCPCallResult =>
  toolResult({
    text: "status: cancelled",
    raw: "",
    data: { state: "cancelled", count: 0, complete: false, scannedFiles, skipped, truncated: false },
  });

function parseArgs(
  raw: Record<string, unknown>,
): { readonly ok: true; readonly args: ParsedSearchArgs } | { readonly ok: false; readonly message: string } {
  if (typeof raw.query !== "string" || raw.query === "") {
    return { ok: false, message: "'query' is required and must be a non-empty string." };
  }
  if (raw.query.length > 500) {
    return { ok: false, message: "'query' is too long (max 500 characters)." };
  }

  let pathArg: string | undefined;
  if (raw.path !== undefined && raw.path !== null) {
    if (typeof raw.path !== "string") return { ok: false, message: "'path' must be a text." };
    if (raw.path.trim() !== "") pathArg = raw.path.trim();
  }

  let filePattern: string | undefined;
  if (raw.filePattern !== undefined && raw.filePattern !== null) {
    if (typeof raw.filePattern !== "string") return { ok: false, message: "'filePattern' must be a text." };
    if (raw.filePattern.trim() !== "") filePattern = raw.filePattern.trim();
  }

  let regex = false;
  if (raw.regex !== undefined && raw.regex !== null) {
    if (typeof raw.regex !== "boolean") return { ok: false, message: "'regex' must be true or false." };
    regex = raw.regex;
  }

  let caseSensitive = false;
  if (raw.caseSensitive !== undefined && raw.caseSensitive !== null) {
    if (typeof raw.caseSensitive !== "boolean") return { ok: false, message: "'caseSensitive' must be true or false." };
    caseSensitive = raw.caseSensitive;
  }

  let maxResults = DEFAULT_SEARCH_MAX_RESULTS;
  if (raw.maxResults !== undefined && raw.maxResults !== null) {
    if (typeof raw.maxResults !== "number" || !Number.isInteger(raw.maxResults) || raw.maxResults < 1) {
      return { ok: false, message: `'maxResults' must be a positive integer (max ${MAX_SEARCH_RESULTS}).` };
    }
    maxResults = Math.min(raw.maxResults, MAX_SEARCH_RESULTS);
  }

  let maxMatchesPerFile = DEFAULT_MAX_MATCHES_PER_FILE;
  if (raw.maxMatchesPerFile !== undefined && raw.maxMatchesPerFile !== null) {
    if (typeof raw.maxMatchesPerFile !== "number" || !Number.isInteger(raw.maxMatchesPerFile) || raw.maxMatchesPerFile < 1) {
      return { ok: false, message: "'maxMatchesPerFile' must be a positive integer." };
    }
    maxMatchesPerFile = Math.min(raw.maxMatchesPerFile, MAX_SEARCH_RESULTS);
  }

  let includeHidden = false;
  if (raw.includeHidden !== undefined && raw.includeHidden !== null) {
    if (typeof raw.includeHidden !== "boolean") return { ok: false, message: "'includeHidden' must be true or false." };
    includeHidden = raw.includeHidden;
  }

  return {
    ok: true,
    args: {
      query: raw.query,
      path: pathArg,
      filePattern,
      regex,
      caseSensitive,
      maxResults,
      maxMatchesPerFile,
      includeHidden,
    },
  };
}

function buildLineMatcher(query: string, regex: boolean, caseSensitive: boolean):
  | { readonly ok: true; readonly matches: (line: string) => boolean }
  | { readonly ok: false; readonly message: string } {
  if (!regex) {
    const needle = caseSensitive ? query : query.toLowerCase();
    return {
      ok: true,
      matches: (line) => (caseSensitive ? line.includes(needle) : line.toLowerCase().includes(needle)),
    };
  }
  try {
    const re = new RegExp(query, caseSensitive ? "" : "i");
    return { ok: true, matches: (line) => re.test(line) };
  } catch (error) {
    return { ok: false, message: `Invalid regular expression in 'query': ${errorMessage(error)}` };
  }
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(BINARY_PROBE_BYTES);
    const { bytesRead } = await handle.read(buf, 0, BINARY_PROBE_BYTES, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

function clipSnippet(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length <= MAX_LINE_SNIPPET_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_LINE_SNIPPET_CHARS)}…`;
}

async function scanSingleFile(
  displayPath: string,
  realPath: string,
  matcher: (line: string) => boolean,
  maxMatches: number,
  signal?: AbortSignal,
): Promise<{ readonly aborted: boolean; readonly matches: readonly ContentMatch[] }> {
  const stream = fs.createReadStream(realPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const matches: ContentMatch[] = [];
  let lineNo = 0;
  let onAbort: (() => void) | undefined;

  try {
    if (signal !== undefined) {
      onAbort = () => {
        rl.close();
        stream.destroy();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    for await (const line of rl) {
      if (signal?.aborted) return { aborted: true, matches };
      lineNo++;
      if (matcher(line)) {
        matches.push({ filePath: displayPath, line: lineNo, text: clipSnippet(line) });
        if (matches.length >= maxMatches) break;
      }
    }
    return { aborted: Boolean(signal?.aborted), matches };
  } finally {
    if (onAbort !== undefined && signal !== undefined) {
      signal.removeEventListener("abort", onAbort);
    }
    rl.close();
    stream.destroy();
  }
}

export async function runSearchContent(
  rawArgs: Record<string, unknown>,
  deps: SearchContentDeps,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  const parsed = parseArgs(rawArgs);
  if (!parsed.ok) return fail(parsed.message);
  const args = parsed.args;

  let fileMatchers: readonly PatternMatcher[] | undefined;
  if (args.filePattern !== undefined) {
    const parsedGlob = parsePattern(args.filePattern, "filePattern");
    if (!parsedGlob.ok) return fail(parsedGlob.message);
    fileMatchers = parsedGlob.matchers;
  }

  const lineMatcher = buildLineMatcher(args.query, args.regex, args.caseSensitive);
  if (!lineMatcher.ok) return fail(lineMatcher.message);

  const targetArg = args.path ?? "home";
  const resolved = await resolveExistingPath(targetArg, deps.getEnvironment, deps.getAllowedDirectories(), {
    expectedKind: "any",
    followSymlinkForAllowedCheck: true,
    paramName: "path",
  });
  if (!resolved.ok) {
    return fail(resolved.message, resolved.denied ? { reason: "denied" } : {});
  }
  if (options.signal?.aborted) return cancelledResult();

  const limitMs =
    options.timeoutMs !== undefined
      ? Math.min(deps.defaultTimeoutMs, Math.max(options.timeoutMs > 2_000 ? options.timeoutMs - 1_500 : options.timeoutMs, 1))
      : deps.defaultTimeoutMs;
  const startedAt = deps.now();
  const deadline = startedAt + limitMs;

  const results: ContentMatch[] = [];
  let scannedFiles = 0;
  let skipped = 0;
  let skippedBinary = 0;
  let skippedLarge = 0;
  let seen = 0;
  let hitDepthLimit = false;
  let stoppedBy: StoppedBy | undefined;
  let cancelled = false;

  const inspectFile = async (displayPath: string, realPath: string, size: number): Promise<void> => {
    if (size > deps.maxFileBytes) {
      skippedLarge++;
      return;
    }
    if (size === 0) {
      scannedFiles++;
      return;
    }
    try {
      if (await isBinaryFile(realPath)) {
        skippedBinary++;
        return;
      }
      if (options.signal?.aborted) {
        cancelled = true;
        return;
      }
      scannedFiles++;
      const remaining = args.maxResults - results.length;
      if (remaining <= 0) {
        stoppedBy = "limit";
        return;
      }
      const perFile = Math.min(args.maxMatchesPerFile, remaining);
      const res = await scanSingleFile(displayPath, realPath, lineMatcher.matches, perFile, options.signal);
      if (res.aborted) {
        cancelled = true;
        return;
      }
      for (const m of res.matches) results.push(m);
      if (results.length >= args.maxResults) {
        stoppedBy = "limit";
      }
    } catch {
      skipped++;
    }
  };

  if (resolved.isFile) {
    await inspectFile(resolved.targetPath, resolved.realTarget, resolved.size);
  } else if (resolved.isDirectory) {
    const realRoot = resolved.realTarget;
    const visitedDirs = new Set<string>([realRoot]);
    const queue: Array<{ readonly dirPath: string; readonly depth: number }> = [{ dirPath: resolved.targetPath, depth: 0 }];

    for (let qi = 0; qi < queue.length; qi++) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }
      if (deps.now() >= deadline) {
        stoppedBy = "time";
        break;
      }
      if (results.length >= args.maxResults) {
        stoppedBy = "limit";
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
        if (scannedFiles >= deps.maxFiles) {
          stoppedBy = "files";
          break;
        }

        seen++;
        if (seen % YIELD_EVERY_ENTRIES === 0) {
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

        if (!args.includeHidden && entry.name.startsWith(".")) continue;

        const fullPath = joinEntryPath(current.dirPath, entry.name);
        let isDir = false;
        let isFile = false;
        let realTarget = fullPath;
        let size = 0;

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
          try {
            const st = await fs.promises.stat(realTarget);
            isDir = st.isDirectory();
            isFile = st.isFile();
            size = isDir ? 0 : st.size;
          } catch {
            skipped++;
            continue;
          }
        } else {
          isDir = entry.isDirectory();
          isFile = entry.isFile();
          if (isDir && isExcludedSubdir(entry.name, fullPath)) continue;
          if (isFile) {
            try {
              const st = await fs.promises.stat(fullPath);
              size = st.size;
            } catch {
              skipped++;
              continue;
            }
          }
        }

        if (isDir) {
          if (isExcludedSubdir(entry.name, fullPath)) continue;
          const nextDepth = current.depth + 1;
          if (nextDepth < deps.maxDepth) {
            if (!visitedDirs.has(realTarget)) {
              visitedDirs.add(realTarget);
              queue.push({ dirPath: fullPath, depth: nextDepth });
            }
          } else {
            hitDepthLimit = true;
          }
          continue;
        }

        if (!isFile) continue;
        if (fileMatchers !== undefined && matchName(entry.name, fileMatchers) === null) continue;

        await inspectFile(fullPath, realTarget, size);
        if (cancelled || stoppedBy !== undefined) break;
      }

      if (cancelled || stoppedBy !== undefined) break;
    }
  } else {
    return fail(`'${resolved.targetPath}' is neither a regular file nor a folder.`);
  }

  if (cancelled) return cancelledResult(scannedFiles, skipped);
  if (stoppedBy === undefined && hitDepthLimit) stoppedBy = "depth";

  const complete = stoppedBy === undefined;
  const state: Exclude<SearchState, "cancelled"> =
    results.length > 0 ? (complete ? "found" : "partial") : complete ? "no_results" : "incomplete";

  const matchWord = results.length === 1 ? "match" : "matches";
  let header: string;
  switch (state) {
    case "found":
      header = `status: found · ${results.length} ${matchWord} · scanned ${scannedFiles} file(s) · complete`;
      break;
    case "partial":
      header = `status: partial · ${results.length} ${matchWord} · stopped by ${stoppedBy} (scanned ${scannedFiles} file(s))`;
      break;
    case "no_results":
      header = `status: no_results · 0 matches · scanned ${scannedFiles} file(s) in ${resolved.targetPath} · complete`;
      break;
    case "incomplete":
      header = `status: incomplete · 0 matches · stopped by ${stoppedBy} (scanned ${scannedFiles} file(s))`;
      break;
  }

  const allLines = results.map((m) => `${m.filePath}:${m.line}: ${m.text}`);
  const fitted = fitLinesToBudget(header, allLines, BUDGET.summaryMax);
  const omitted = allLines.length - fitted.shown.length;
  const textLines = [header, ...fitted.shown, ...(omitted > 0 ? [omissionMarker(omitted, "coincidencias")] : [])];

  return toolResult({
    text: textLines.join("\n"),
    raw: [header, ...allLines].join("\n"),
    data: {
      state,
      count: results.length,
      complete,
      scannedFiles,
      skipped,
      skippedBinary,
      skippedLarge,
      ...(stoppedBy === undefined ? {} : { stoppedBy }),
      truncated: fitted.truncated,
    },
    meta: {
      query: args.query,
      path: resolved.targetPath,
      durationMs: deps.now() - startedAt,
    },
  });
}
