/**
 * `jarvis_files_read`: herramienta `read_file` (grupo de solo lectura).
 *
 * Lee archivos de forma aislada respecto del grupo de escritura (`files_write`) y despacha
 * internamente según el tipo/extensión del archivo mediante drivers extensibles:
 * - Texto plano (código, JSON, CSV, Markdown, logs, etc.): lectura por stream con rango por líneas
 *   (`offset`, `limit`), detección temprana de binarios (bytes NUL) y recorte seguro de líneas largas.
 * - Formatos enriquecidos (`.pdf`, `.docx`, `.xlsx`, `.pptx`, imágenes): registro extensible de drivers
 *   (`ReadFileDriver`); si un formato no tiene driver conectado todavía, responde con error explícito
 *   (`unsupported_format`) sin volcar bytes binarios crudos.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { BUDGET } from "../../core/budget.ts";
import type { UserEnvironment } from "../../core/environment.ts";
import { omissionMarker } from "../../core/text.ts";
import { fitLinesToBudget, formatSize, resolveExistingPath } from "../../core/tools/filePaths.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

export const DEFAULT_READ_OFFSET = 1;
export const DEFAULT_READ_LIMIT = 200;
export const MAX_READ_LIMIT = 2_000;
export const MAX_DISPLAY_LINE_CHARS = 500;
export const BINARY_PROBE_BYTES = 8_192;

const STRUCTURED_BINARY_EXTS: ReadonlySet<string> = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "xlsm",
  "ppt",
  "pptx",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "ico",
  "zip",
  "7z",
  "rar",
  "tar",
  "gz",
  "exe",
  "dll",
  "bin",
]);

export interface ReadDriverContext {
  readonly targetPath: string;
  readonly realTarget: string;
  readonly extension: string;
  readonly size: number;
  readonly offset: number;
  readonly limit: number;
  readonly encoding: BufferEncoding;
  readonly args: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface ReadFileDriver {
  readonly id: string;
  readonly extensions: readonly string[];
  read(ctx: ReadDriverContext): Promise<MCPCallResult>;
}

export interface ReadFileDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly drivers?: readonly ReadFileDriver[];
}

interface ParsedReadArgs {
  readonly path: string;
  readonly offset: number;
  readonly limit: number;
  readonly encoding: "utf8" | "latin1";
}

const VALID_ENCODINGS = ["utf8", "latin1"] as const;

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", truncated: false } });

function parseArgs(
  raw: Record<string, unknown>,
): { readonly ok: true; readonly args: ParsedReadArgs } | { readonly ok: false; readonly message: string } {
  if (typeof raw.path !== "string" || raw.path.trim() === "") {
    return { ok: false, message: "'path' is required: an absolute file path or ~ relative path." };
  }

  let offset = DEFAULT_READ_OFFSET;
  if (raw.offset !== undefined && raw.offset !== null) {
    if (typeof raw.offset !== "number" || !Number.isInteger(raw.offset) || raw.offset < 1) {
      return { ok: false, message: "'offset' must be a positive integer >= 1 (1-based line number)." };
    }
    offset = raw.offset;
  }

  let limit = DEFAULT_READ_LIMIT;
  if (raw.limit !== undefined && raw.limit !== null) {
    if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1) {
      return { ok: false, message: `'limit' must be a positive integer (max ${MAX_READ_LIMIT}).` };
    }
    limit = Math.min(raw.limit, MAX_READ_LIMIT);
  }

  let encoding: "utf8" | "latin1" = "utf8";
  if (raw.encoding !== undefined && raw.encoding !== null) {
    if (typeof raw.encoding !== "string" || !(VALID_ENCODINGS as readonly string[]).includes(raw.encoding)) {
      return { ok: false, message: `'encoding' must be one of: ${VALID_ENCODINGS.join(", ")}.` };
    }
    encoding = raw.encoding as "utf8" | "latin1";
  }

  return { ok: true, args: { path: raw.path.trim(), offset, limit, encoding } };
}

/** Comprueba en el primer bloque si el archivo contiene bytes NUL (indicador de binario). */
async function hasNullByte(filePath: string): Promise<boolean> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(BINARY_PROBE_BYTES);
    const { bytesRead } = await handle.read(buf, 0, BINARY_PROBE_BYTES, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

function clipDisplayLine(line: string): string {
  if (line.length <= MAX_DISPLAY_LINE_CHARS) return line;
  return `${line.slice(0, MAX_DISPLAY_LINE_CHARS)}… (+${line.length - MAX_DISPLAY_LINE_CHARS} chars)`;
}

/** Driver por defecto para archivos de texto plano mediante stream (sin cargar todo el archivo en RAM). */
async function readPlainText(ctx: ReadDriverContext): Promise<MCPCallResult> {
  if (ctx.signal?.aborted) return cancelledResult();

  if (ctx.size > 0 && (await hasNullByte(ctx.realTarget))) {
    return fail(`'${ctx.targetPath}' appears to be a binary file and cannot be read as plain text.`, {
      reason: "binary_file",
    });
  }
  if (ctx.signal?.aborted) return cancelledResult();

  if (ctx.size === 0) {
    const text = `status: ok · file: ${ctx.targetPath} (0 B, 0 lines)\n(file is empty)`;
    return toolResult({
      text,
      raw: text,
      data: {
        state: "ok",
        format: "text",
        path: ctx.targetPath,
        sizeBytes: 0,
        totalLines: 0,
        fromLine: 0,
        toLine: 0,
        hasMore: false,
        truncated: false,
      },
    });
  }

  const startLine = ctx.offset;
  const endLine = ctx.offset + ctx.limit - 1;
  const collected: Array<{ readonly lineNo: number; readonly rawLine: string }> = [];
  let totalLines = 0;

  const stream = fs.createReadStream(ctx.realTarget, { encoding: ctx.encoding });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let onAbort: (() => void) | undefined;
  let streamError: Error | undefined;
  const onStreamError = (err: Error) => {
    if (!ctx.signal?.aborted) {
      streamError = err;
    }
  };
  stream.on("error", onStreamError);
  rl.on("error", onStreamError);

  try {
    if (ctx.signal !== undefined) {
      onAbort = () => {
        rl.close();
        stream.destroy();
      };
      ctx.signal.addEventListener("abort", onAbort, { once: true });
    }

    for await (const line of rl) {
      if (ctx.signal?.aborted) return cancelledResult();
      totalLines++;
      if (totalLines >= startLine && totalLines <= endLine) {
        collected.push({ lineNo: totalLines, rawLine: line });
      }
    }
  } finally {
    if (onAbort !== undefined && ctx.signal !== undefined) {
      ctx.signal.removeEventListener("abort", onAbort);
    }
    rl.close();
    stream.destroy();
  }

  if (ctx.signal?.aborted) return cancelledResult();
  if (streamError !== undefined) throw streamError;

  if (startLine > totalLines) {
    return fail(`Requested offset line ${startLine} exceeds total line count (${totalLines}) of '${ctx.targetPath}'.`, {
      reason: "offset_out_of_range",
      totalLines,
    });
  }

  const fromLine = collected[0].lineNo;
  const toLine = collected[collected.length - 1].lineNo;
  const hasMore = toLine < totalLines;
  const width = String(toLine).length;
  const padNo = (n: number) => String(n).padStart(width, " ");

  const rawLines = collected.map((l) => `${padNo(l.lineNo)} | ${l.rawLine}`);
  const displayLines = collected.map((l) => `${padNo(l.lineNo)} | ${clipDisplayLine(l.rawLine)}`);

  const header = `status: ok · file: ${ctx.targetPath} (${formatSize(ctx.size)}, lines ${fromLine}-${toLine} of ${totalLines})`;
  const footerNote = hasMore ? `[... ${totalLines - toLine} more line(s) after line ${toLine}; pass offset=${toLine + 1} to continue]` : null;

  const reserve = header.length + (footerNote ? footerNote.length + 2 : 0) + 80;
  const fitted = fitLinesToBudget(header, displayLines, BUDGET.summaryMax, reserve);
  const omittedCount = displayLines.length - fitted.shown.length;
  const textTruncated = omittedCount > 0 || collected.some((l) => l.rawLine.length > MAX_DISPLAY_LINE_CHARS);

  const textParts = [
    header,
    ...fitted.shown,
    ...(omittedCount > 0 ? [omissionMarker(omittedCount, "líneas")] : []),
    ...(footerNote !== null ? [footerNote] : []),
  ];
  const rawParts = [header, ...rawLines, ...(footerNote !== null ? [footerNote] : [])];

  return toolResult({
    text: textParts.join("\n"),
    raw: rawParts.join("\n"),
    data: {
      state: "ok",
      format: "text",
      path: ctx.targetPath,
      sizeBytes: ctx.size,
      totalLines,
      fromLine,
      toLine,
      hasMore,
      truncated: textTruncated,
    },
  });
}

export async function runReadFile(
  rawArgs: Record<string, unknown>,
  deps: ReadFileDeps,
  options: { readonly signal?: AbortSignal } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult();

  const parsed = parseArgs(rawArgs);
  if (!parsed.ok) return fail(parsed.message);
  const args = parsed.args;

  const resolved = await resolveExistingPath(args.path, deps.getEnvironment, deps.getAllowedDirectories(), {
    expectedKind: "file",
    followSymlinkForAllowedCheck: true,
    paramName: "path",
  });
  if (!resolved.ok) {
    return fail(resolved.message, {
      ...(resolved.denied ? { reason: "denied" } : resolved.notFound ? { reason: "not_found" } : {}),
    });
  }
  if (options.signal?.aborted) return cancelledResult();

  const ext = path.extname(resolved.realTarget).replace(/^\./, "").toLowerCase();
  const driverCtx: ReadDriverContext = {
    targetPath: resolved.targetPath,
    realTarget: resolved.realTarget,
    extension: ext,
    size: resolved.size,
    offset: args.offset,
    limit: args.limit,
    encoding: args.encoding,
    args: rawArgs,
    signal: options.signal,
  };

  if (ext !== "" && deps.drivers !== undefined) {
    const customDriver = deps.drivers.find((d) =>
      d.extensions.some((supported) => supported.replace(/^\./, "").toLowerCase() === ext),
    );
    if (customDriver !== undefined) {
      try {
        return await customDriver.read(driverCtx);
      } catch (error) {
        if (options.signal?.aborted) return cancelledResult();
        return fail(`Driver '${customDriver.id}' failed reading '${resolved.targetPath}': ${errorMessage(error)}`);
      }
    }
  }

  if (STRUCTURED_BINARY_EXTS.has(ext)) {
    return fail(
      `Reading '.${ext}' files requires a format driver that is not installed yet (file: '${resolved.targetPath}').`,
      { reason: "unsupported_format", extension: ext },
    );
  }

  try {
    return await readPlainText(driverCtx);
  } catch (error) {
    if (options.signal?.aborted) return cancelledResult();
    return fail(`Cannot read file '${resolved.targetPath}': ${errorMessage(error)}`);
  }
}
