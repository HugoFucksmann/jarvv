/**
 * JARVIS Core — Procesador de resultados de herramientas (Fase 4)
 *
 * Convierte el resultado MCP crudo en lo que el ejecutor necesita para registrar la llamada (PLAN_CONTEXT 5.2 y 5.3):
 * el `status` de lo que hizo la herramienta (sin veredicto), el `summary` recortado, si se omitió contenido
 * (`truncated`: el ejecutor lo usa para decidir si la llamada lleva `ref`), el texto crudo que va a la ref y, en las
 * herramientas de procesos, la señal `process`. No guarda nada, no toca el contexto, no conoce tareas ni refs, y no
 * sanea (C9: el saneado lo hacen las vistas). `exception` e `interrupted` los produce el ejecutor.
 */

import type { MCPCallResult, MCPContentItem } from "../types.ts";
import type { CallStatus } from "../ctx/types.ts";

import { getToolPolicy } from "../tools/manifest.ts";
import { isRecord } from "../utils.ts";
import { fitToCap } from "../text.ts";
import { selectExtractor } from "./extractors/index.ts";
import type { ExtractorInput, ProcessSignal } from "./extractors/types.ts";
import { BUDGET } from "../budget.ts";


export type { ProcessSignal } from "./extractors/types.ts";

/** Estados que puede producir el procesador (los de una llamada que terminó de ejecutarse, más `denied` del servidor). */
export type ProcessedStatus = Extract<CallStatus, "ok" | "no_data" | "not_found" | "tool_error" | "denied">;

export interface ProcessedResult {
  status: ProcessedStatus;
  /** Resultado recortado a `BUDGET.summaryMax`, sin claves de ref; `null` cuando el `status` basta. */
  summary: string | null;
  /** `true` si el resumen no contiene el resultado completo: el extractor omitió contenido o hubo que recortar al tope. */
  truncated: boolean;
  /** Resultado crudo (bloques `text` unidos con `\n` y `trim()`): es lo que se guarda en la ref. Puede ser `""`. */
  fullText: string;
  /** Solo en las herramientas de procesos y solo si el pid se conoce. */
  process?: ProcessSignal;
}

interface CollectedContent {
  /** Texto de todos los elementos `text`, unido y sin espacios en los extremos. */
  text: string;
  /** Campos de los elementos `text` que son JSON (un arreglo se expone como `results`). */
  embeddedPayload: Record<string, unknown>;
}

const looksLikeJson = (s: string): boolean =>
  (s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"));

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined; // Texto con forma de JSON que no lo es: se trata solo como texto.
  }
}

/** Los elementos que no son `text` (imagen, recurso) no aportan texto: no se guardan ni dejan marca. */
function collectContent(items: readonly MCPContentItem[]): CollectedContent {
  const textPieces: string[] = [];
  let embeddedPayload: Record<string, unknown> = {};

  for (const item of items) {
    if (item.type !== "text" || typeof item.text !== "string") continue;
    textPieces.push(item.text);
    const trimmed = item.text.trim();
    if (!looksLikeJson(trimmed)) continue;
    const parsed = tryParseJson(trimmed);
    if (Array.isArray(parsed)) {
      embeddedPayload.results = parsed;
    } else if (isRecord(parsed)) {
      embeddedPayload = { ...embeddedPayload, ...parsed };
    }
  }
  return { text: textPieces.join("\n").trim(), embeddedPayload };
}

/**
 * Campos de control del resultado: código de salida y tiempo agotado. ÚNICO punto donde se leen del resultado MCP y
 * del JSON embebido en el texto. Hoy valen para cualquier herramienta (comportamiento heredado); restringir el JSON
 * embebido a las herramientas de procesos es la DECISIÓN NUEVA N1 de `SUPUESTOS_FASE_4.md`, pendiente de respuesta.
 */
function controlFieldsOf(merged: Record<string, unknown>): { exitCode: number | undefined; timedOut: boolean } {
  return {
    exitCode: typeof merged.exit_code === "number" ? merged.exit_code : undefined,
    timedOut: Boolean(merged.timed_out),
  };
}

/**
 * Procesa el resultado de una herramienta ya despachada.
 *
 * Precedencia del `status` (D3 de la Fase 4):
 *  1. `denied`: resultado con error que trae `[DENIED]` o "access denied" (política del servidor, 5.3). Un texto exitoso
 *     que contenga esa frase es dato (un archivo, una página) y no cuenta.
 *  2. `not_found`: el texto EMPIEZA con `[NOT_FOUND]`, o es un error con ese marcador, "not found" o ENOENT.
 *  3. `tool_error`: error, `success = false`, tiempo agotado o código de salida distinto de 0.
 *  4. `no_data`: salida vacía en una herramienta con `emptyIsError`, o el extractor marcó `empty_output`.
 *  5. `ok`.
 */
export function processResult(
  mcp: string,
  tool: string,
  rawResult: MCPCallResult,
  args: Record<string, unknown>
): ProcessedResult {
  const isError = Boolean(rawResult.isError);
  const success = rawResult.success !== undefined ? Boolean(rawResult.success) : !isError;

  const { text: fullText, embeddedPayload } = collectContent(rawResult.content || []);
  // Forma libre: los extractores leen los campos propios de cada servidor (process_id, exit_code…).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mergedData: Record<string, any> = { ...rawResult, ...embeddedPayload };
  const policy = getToolPolicy(mcp, tool);

  const input: ExtractorInput = { mcp, tool, args, isError, success, fullText, mergedData };
  const extracted = selectExtractor(mcp, tool, isError)(input);

  const lowerText = fullText.toLowerCase();
  const denied = isError && (fullText.includes("[DENIED]") || lowerText.includes("access denied"));
  const notFound =
    fullText.startsWith("[NOT_FOUND]") ||
    (isError &&
      (fullText.includes("[NOT_FOUND]") || lowerText.includes("not found") || /\benoent\b|no such file or directory/.test(lowerText)));

  const control = controlFieldsOf(mergedData);
  const exitCode = control.exitCode ?? extracted.signals?.exit_code;
  const failed = isError || !success || control.timedOut || (exitCode !== undefined && exitCode !== 0);
  const noData = (policy.emptyIsError === true && fullText.length === 0) || extracted.signals?.empty_output === true;

  const status: ProcessedStatus = denied ? "denied" : notFound ? "not_found" : failed ? "tool_error" : noData ? "no_data" : "ok";

  // Nunca `""` (5.2). Red de seguridad: ningún extractor puede dejar pasar un resumen mayor que el tope.
  let summary = extracted.summary !== null && extracted.summary.trim().length > 0 ? extracted.summary : null;
  let truncated = extracted.truncated;
  if (summary !== null && summary.length > BUDGET.summaryMax) {
    summary = fitToCap(summary, BUDGET.summaryMax).text;
    truncated = true;
  }

  return {
    status,
    summary,
    truncated,
    fullText,
    ...(extracted.process ? { process: extracted.process } : {}),
  };
}
