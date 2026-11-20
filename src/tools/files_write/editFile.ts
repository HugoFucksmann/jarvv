/**
 * `jarvis_files_write`: herramienta `edit_file`.
 *
 * Edita texto puntual en archivos de texto sin reescribir el archivo entero desde cero:
 * - Rechaza directorios, archivos binarios (bytes NUL) y archivos mayores al tope (`maxFileBytes`).
 * - Exige coincidencia inequívoca salvo que `replaceAll: true` o coincida con `expectedReplacements`.
 * - Si no encuentra `oldText` exactamente pero sí tras normalizar `\r\n` vs `\n`, lo informa en el error.
 */

import fs from "node:fs";
import type { UserEnvironment } from "../../core/environment.ts";
import { resolveExistingPath } from "../../core/tools/filePaths.ts";
import { toolResult } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";

export const DEFAULT_EDIT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const BINARY_PROBE_BYTES = 8_192;

export interface EditFileDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly maxFileBytes: number;
}

interface ParsedEditArgs {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
  readonly replaceAll: boolean;
  readonly expectedReplacements?: number;
}

const fail = (message: string, data: Record<string, unknown> = {}): MCPCallResult =>
  toolResult({ text: message, raw: message, data: { state: "error", truncated: false, ...data }, isError: true });

const cancelledResult = (): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", truncated: false } });

function parseArgs(
  raw: Record<string, unknown>,
): { readonly ok: true; readonly args: ParsedEditArgs } | { readonly ok: false; readonly message: string } {
  if (typeof raw.path !== "string" || raw.path.trim() === "") {
    return { ok: false, message: "'path' is required: an existing text file path." };
  }
  if (typeof raw.oldText !== "string" || raw.oldText === "") {
    return { ok: false, message: "'oldText' is required and must be a non-empty string." };
  }
  if (typeof raw.newText !== "string") {
    return { ok: false, message: "'newText' is required and must be a string." };
  }
  if (raw.oldText === raw.newText) {
    return { ok: false, message: "'newText' is identical to 'oldText'; there is nothing to change." };
  }

  let replaceAll = false;
  if (raw.replaceAll !== undefined && raw.replaceAll !== null) {
    if (typeof raw.replaceAll !== "boolean") {
      return { ok: false, message: "'replaceAll' must be true or false." };
    }
    replaceAll = raw.replaceAll;
  }

  let expectedReplacements: number | undefined;
  if (raw.expectedReplacements !== undefined && raw.expectedReplacements !== null) {
    if (typeof raw.expectedReplacements !== "number" || !Number.isInteger(raw.expectedReplacements) || raw.expectedReplacements < 1) {
      return { ok: false, message: "'expectedReplacements' must be a positive integer >= 1." };
    }
    expectedReplacements = raw.expectedReplacements;
  }

  return {
    ok: true,
    args: {
      path: raw.path.trim(),
      oldText: raw.oldText,
      newText: raw.newText,
      replaceAll,
      expectedReplacements,
    },
  };
}

function findOccurrences(haystack: string, needle: string): number[] {
  const indices: number[] = [];
  let pos = 0;
  while (pos <= haystack.length) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    indices.push(idx);
    pos = idx + needle.length;
  }
  return indices;
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

export async function runEditFile(
  rawArgs: Record<string, unknown>,
  deps: EditFileDeps,
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

  if (resolved.size > deps.maxFileBytes) {
    return fail(`File '${resolved.targetPath}' is too large to edit safely (${resolved.size} B > ${deps.maxFileBytes} B).`, {
      reason: "file_too_large",
    });
  }

  let rawBuffer: Buffer;
  try {
    rawBuffer = await fs.promises.readFile(resolved.realTarget);
  } catch (error) {
    return fail(`Cannot read file '${resolved.targetPath}': ${errorMessage(error)}`);
  }
  if (options.signal?.aborted) return cancelledResult();

  const probeLen = Math.min(rawBuffer.length, BINARY_PROBE_BYTES);
  if (rawBuffer.subarray(0, probeLen).includes(0)) {
    return fail(`'${resolved.targetPath}' appears to be a binary file and cannot be edited with edit_file.`, {
      reason: "binary_file",
    });
  }

  const content = rawBuffer.toString("utf8");
  const indices = findOccurrences(content, args.oldText);

  if (indices.length === 0) {
    const normContent = content.replace(/\r\n/g, "\n");
    const normOld = args.oldText.replace(/\r\n/g, "\n");
    const crlfHint = normContent.includes(normOld)
      ? " (note: text matched after normalizing CRLF/LF line endings; match the file's exact line endings)."
      : "";
    return fail(`'oldText' was not found in '${resolved.targetPath}'${crlfHint}.`, {
      reason: "not_matched",
    });
  }

  if (args.expectedReplacements !== undefined && indices.length !== args.expectedReplacements) {
    return fail(
      `Expected ${args.expectedReplacements} occurrence(s) of 'oldText' in '${resolved.targetPath}', but found ${indices.length}.`,
      { reason: "count_mismatch", occurrences: indices.length },
    );
  }

  if (indices.length > 1 && !args.replaceAll && args.expectedReplacements === undefined) {
    const lines = indices.slice(0, 10).map((i) => lineNumberAt(content, i));
    return fail(
      `'oldText' matched ${indices.length} times in '${resolved.targetPath}' (lines ${lines.join(", ")}). Provide more surrounding context or pass replaceAll: true.`,
      { reason: "ambiguous_match", occurrences: indices.length, lines },
    );
  }

  const linesAffected = indices.map((i) => lineNumberAt(content, i));
  const updated = content.split(args.oldText).join(args.newText);

  try {
    await fs.promises.writeFile(resolved.realTarget, updated, "utf8");
  } catch (error) {
    return fail(`Cannot write edited file '${resolved.targetPath}': ${errorMessage(error)}`);
  }

  const text = `status: ok · replaced ${indices.length} occurrence(s) in ${resolved.targetPath} (line(s): ${linesAffected.slice(0, 10).join(", ")}${linesAffected.length > 10 ? ", …" : ""})`;
  return toolResult({
    text,
    raw: text,
    data: {
      state: "ok",
      path: resolved.targetPath,
      replacements: indices.length,
      lines: linesAffected,
      truncated: false,
    },
  });
}
