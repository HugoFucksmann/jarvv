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
import { effectiveTimeoutMs, fitLinesToBudget, isBinaryFile, resolveExistingPath } from "../../core/tools/filePaths.ts";
import { matchName, parsePattern, type PatternMatcher } from "../../core/tools/globPattern.ts";
import { toolResult } from "../../core/tools/result.ts";
import { walkFolder } from "../../core/tools/walkFolder.ts";
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
  let closedEarly = false;
  let streamError: Error | undefined;
  const onStreamError = (err: Error) => {
    if (!signal?.aborted && !closedEarly) {
      streamError = err;
    }
  };
  stream.on("error", onStreamError);
  rl.on("error", onStreamError);

  try {
    if (signal !== undefined) {
      onAbort = () => {
        closedEarly = true;
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
        if (matches.length >= maxMatches) {
          closedEarly = true;
          break;
        }
      }
    }
    if (signal?.aborted) return { aborted: true, matches };
    if (streamError !== undefined) throw streamError;
    return { aborted: false, matches };
  } finally {
    if (onAbort !== undefined && signal !== undefined) {
      signal.removeEventListener("abort", onAbort);
    }
    closedEarly = true;
    rl.close();
    stream.destroy();
  }
}

interface SearchSummary {
  readonly query: string;
  readonly targetPath: string;
  readonly scannedFiles: number;
  readonly skipped: number;
  readonly skippedBinary: number;
  readonly skippedLarge: number;
  /** Por qué se cortó el recorrido; `undefined` si terminó (el resultado es completo). */
  readonly stoppedBy: StoppedBy | undefined;
  readonly durationMs: number;
}

/** El resultado: honesto sobre si fue completo (`found`, `no_results`) o se cortó (`partial`, `incomplete`), con las líneas ajustadas al presupuesto de texto. */
function renderSearchResult(results: readonly ContentMatch[], summary: SearchSummary): MCPCallResult {
  const { query, targetPath, scannedFiles, skipped, skippedBinary, skippedLarge, stoppedBy, durationMs } = summary;
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
      header = `status: no_results · 0 matches · scanned ${scannedFiles} file(s) in ${targetPath} · complete`;
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
    meta: { query, path: targetPath, durationMs },
  });
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

  const limitMs = effectiveTimeoutMs(deps.defaultTimeoutMs, options.timeoutMs);
  const startedAt = deps.now();
  const deadline = startedAt + limitMs;

  const results: ContentMatch[] = [];
  let scannedFiles = 0;
  let skipped = 0;
  let skippedBinary = 0;
  let skippedLarge = 0;
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
    const walk = walkFolder({
      root: resolved.targetPath,
      realRoot: resolved.realTarget,
      maxDepth: deps.maxDepth,
      deadline,
      now: deps.now,
      signal: options.signal,
      includeHidden: args.includeHidden,
      statFiles: true,
    });

    for await (const entry of walk.entries) {
      if (results.length >= args.maxResults) {
        stoppedBy = "limit";
        break;
      }
      if (scannedFiles >= deps.maxFiles) {
        stoppedBy = "files";
        break;
      }
      if (!entry.isFile) continue;
      if (fileMatchers !== undefined && matchName(entry.name, fileMatchers) === null) continue;

      await inspectFile(entry.path, entry.realPath, entry.size ?? 0);
      if (cancelled || stoppedBy !== undefined) break;
    }

    skipped += walk.state.skipped;
    hitDepthLimit = walk.state.hitDepthLimit;
    cancelled ||= walk.state.cancelled;
    if (walk.state.stoppedBy === "time") stoppedBy ??= "time";
  } else {
    return fail(`'${resolved.targetPath}' is neither a regular file nor a folder.`);
  }

  if (cancelled) return cancelledResult(scannedFiles, skipped);
  if (stoppedBy === undefined && hitDepthLimit) stoppedBy = "depth";

  return renderSearchResult(results, {
    query: args.query,
    targetPath: resolved.targetPath,
    scannedFiles,
    skipped,
    skippedBinary,
    skippedLarge,
    stoppedBy,
    durationMs: deps.now() - startedAt,
  });
}
