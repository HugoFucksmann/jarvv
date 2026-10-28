import type {
  MCPCallResult,
  MCPContentItem,
  Evidence,
  VerificationState,
  ExecutionOutcome,
  Scratchpad,
  StepExecutionSignals,
} from "../types.ts";
import { MAX_EVIDENCE_OBS_CHARS } from "../types.ts";
import { getToolPolicy } from "../tools/manifest.ts";
import { isRecord } from "../utils.ts";
import { RefStore, refLabel, evidenceRef } from "./refStore.ts";
import type { ExtractorInput, ExtractorOutput } from "./extractors/types.ts";
import { selectExtractor } from "./extractors/index.ts";

export interface ProcessedResult {
  outcome: ExecutionOutcome;
  evidence: Evidence;
  verification: VerificationState;
  scratchpadDelta: Partial<Scratchpad>;
  finding: string;
  compactObs: string;
  factsDelta: Record<string, string>;
  signals: StepExecutionSignals;
  refKey?: string;
  decisionSummary: string;
}

interface CollectedContent {
  /** Texto de todos los elementos `text`, unido y recortado. */
  text: string;
  /** Campos de los elementos `text` que son JSON (un arreglo se expone como `results`). */
  embeddedPayload: Record<string, unknown>;
  flags: string[];
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

/** Texto, payload JSON embebido y banderas de los elementos de contenido de un resultado MCP. */
function collectContent(items: readonly MCPContentItem[]): CollectedContent {
  const textPieces: string[] = [];
  const flags: string[] = [];
  let embeddedPayload: Record<string, unknown> = {};

  for (const item of items) {
    if (item.type === "text" && typeof item.text === "string") {
      textPieces.push(item.text);
      const trimmed = item.text.trim();
      if (!looksLikeJson(trimmed)) continue;
      const parsed = tryParseJson(trimmed);
      if (Array.isArray(parsed)) {
        embeddedPayload.results = parsed;
      } else if (isRecord(parsed)) {
        embeddedPayload = { ...embeddedPayload, ...parsed };
      }
    } else if (item.type === "image") {
      flags.push("IMAGE_CONTENT_ATTACHED");
    } else if (item.type === "resource" && item.uri) {
      flags.push(`RESOURCE_REF:${item.uri}`);
    }
  }
  return { text: textPieces.join("\n").trim(), embeddedPayload, flags };
}

/**
 * Señales de ejecución. Una señal textual solo es fiable en un resultado de error o cuando el texto
 * EMPIEZA con el marcador explícito (así los emiten los adaptadores). En un resultado exitoso el texto es dato
 * (archivos, páginas, búsquedas): que contenga "not found", "access denied" o "timeout" no describe cómo terminó la
 * herramienta.
 */
function deriveSignals(
  fullText: string,
  isError: boolean,
  emptyIsError: boolean,
  mergedData: Record<string, unknown>
): StepExecutionSignals {
  const lowerText = fullText.toLowerCase();
  const leadsWith = (marker: string) => fullText.startsWith(marker);
  const isNotFound =
    leadsWith("[NOT_FOUND]") ||
    (isError && (fullText.includes("[NOT_FOUND]") || lowerText.includes("not found") || /\benoent\b|no such file or directory/.test(lowerText)));
  const isDenied =
    leadsWith("[DENIED]") || (isError && (fullText.includes("[DENIED]") || lowerText.includes("access denied")));

  return {
    exit_code: typeof mergedData.exit_code === "number" ? mergedData.exit_code : (isError ? 1 : undefined),
    exception: isError && !isNotFound && !isDenied,
    timeout: Boolean(mergedData.timed_out || (isError && /timeout/i.test(fullText))),
    not_found: isNotFound,
    denied: isDenied,
    // La vacuidad de `free_search:search` se decide en su rama (necesita el recuento y los resultados leídos).
    empty_output: emptyIsError && fullText.length === 0,
  };
}

/** Resumen estructurado para modelos clasificadores (Decision 2.0). */
function buildDecisionSummary(
  tool: string,
  finding: string,
  signals: StepExecutionSignals,
  isError: boolean,
  success: boolean
): string {
  if (signals.not_found) return `[NOT FOUND] ${tool}: ${finding}. Resource not found.`;
  if (signals.empty_output) return `[EMPTY] ${tool}: ${finding}. The output contains no useful data.`;
  if (isError || (signals.exit_code !== undefined && signals.exit_code !== 0) || signals.denied) {
    return `[FAILURE] ${tool}: ${finding || "Execution error"}.`;
  }
  if (success) return `[SUCCESS] ${tool}: ${finding}. Information obtained and stored in memory.`;
  return `[INFO] ${tool}: ${finding}.`;
}

export class ResultProcessor {
  /**
   * Processes a raw MCP ToolResult into structured Core state and memory tokens.
   */
  static process(
    mcp: string,
    tool: string,
    rawResult: MCPCallResult,
    args: Record<string, unknown>,
    taskId: string
  ): ProcessedResult {
    const isError = Boolean(rawResult.isError);
    const success = rawResult.success !== undefined ? Boolean(rawResult.success) : !isError;
    const outcome: ExecutionOutcome = { success, isError };

    // 1. Texto y payloads embebidos de los elementos de contenido
    const { text: fullText, embeddedPayload, flags } = collectContent(rawResult.content || []);
    // Forma libre: los extractores leen los campos propios de cada servidor (exit_code, timed_out…).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mergedData: Record<string, any> = { ...rawResult, ...embeddedPayload };
    const policy = getToolPolicy(mcp, tool);

    // 2. Señales
    const signals = deriveSignals(fullText, isError, policy.emptyIsError === true, mergedData);

    // 3. Resultado completo en el RefStore aislado por tarea
    const refKey = fullText.length > 0 ? RefStore.put(fullText, taskId, refLabel(tool, args)) : undefined;

    // 4. Extractor determinista por herramienta: registro en extractors/index.ts; el genérico es el respaldo.
    const input: ExtractorInput = { mcp, tool, args, isError, success, fullText, mergedData, refKey };
    const extracted: ExtractorOutput = selectExtractor(mcp, tool, isError)(input);
    const { finding, compactObs } = extracted;
    const factsDelta: Record<string, string> = { ...extracted.factsDelta };
    const scratchpadDelta: Partial<Scratchpad> = { ...extracted.scratchpadDelta };
    Object.assign(signals, extracted.signals);

    // 5. VerificationState
    const ok = success && !isError && !signals.empty_output && !signals.not_found;
    const verification: VerificationState = ok ? "VERIFIED" : "NOT_REQUIRED";

    // 6. Evidencia
    const evidence: Evidence = {
      ok,
      summary: finding,
      obs: compactObs ? compactObs.slice(0, MAX_EVIDENCE_OBS_CHARS) : undefined,
      flags: flags.length > 0 ? flags : undefined,
      ref: evidenceRef(mcp, tool, refKey),
    };

    return {
      outcome,
      evidence,
      verification,
      scratchpadDelta,
      finding,
      compactObs,
      factsDelta,
      signals,
      refKey,
      decisionSummary: buildDecisionSummary(tool, finding, signals, isError, success),
    };
  }
}