import type {
  MCPCallResult,
  Evidence,
  VerificationState,
  ExecutionOutcome,
  Scratchpad,
  StepExecutionSignals,
} from "../types.ts";
import { MAX_EVIDENCE_OBS_CHARS } from "../types.ts";
import { getToolPolicy } from "../tools/manifest.ts";
import { RefStore, refLabel, evidenceRef } from "./refStore.ts";
import type { ExtractorInput, ExtractorOutput } from "./extractors/types.ts";
import { extractListDirectory, extractReadFile } from "./extractors/files.ts";
import { extractProcess } from "./extractors/process.ts";
import { extractSearch, extractFetch } from "./extractors/freeSearch.ts";
import { extractGeneric } from "./extractors/generic.ts";

export interface ProcessedResult {
  outcome: ExecutionOutcome;
  evidence: Evidence;
  verification: VerificationState;
  scratchpadDelta: Partial<Scratchpad>;
  summaryText: string;
  finding: string;
  compactObs: string;
  factsDelta: Record<string, string>;
  signals: StepExecutionSignals;
  refKey?: string;
  decisionSummary: string;
}

export class ResultProcessor {
  /**
   * Processes a raw MCP ToolResult into structured Core state and memory tokens.
   */
  static process(
    mcp: string,
    tool: string,
    rawResult: MCPCallResult,
    args: Record<string, unknown> = {},
    taskId: string
  ): ProcessedResult {
    const isError = Boolean(rawResult.isError);
    const success = Boolean(rawResult.success !== undefined ? rawResult.success : !isError);

    const outcome: ExecutionOutcome = {
      success,
      isError,
    };

    const flags: string[] = [];
    const scratchpadDelta: Partial<Scratchpad> = {};
    const factsDelta: Record<string, string> = {};

    // 1. Extract raw text and embedded payloads from content items
    const contentItems = rawResult.content || [];
    const textPieces: string[] = [];
    let embeddedPayload: Record<string, any> = {};

    for (const item of contentItems) {
      if (item.type === "text" && typeof item.text === "string") {
        textPieces.push(item.text);
        const trimmed = item.text.trim();
        if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              embeddedPayload = { ...embeddedPayload, ...parsed };
            } else if (Array.isArray(parsed)) {
              embeddedPayload.results = parsed;
            }
          } catch { }
        }
      } else if (item.type === "image") {
        flags.push("IMAGE_CONTENT_ATTACHED");
      } else if (item.type === "resource" && item.uri) {
        flags.push(`RESOURCE_REF:${item.uri}`);
      }
    }

    const mergedData: Record<string, any> = { ...rawResult, ...embeddedPayload };
    const fullText = textPieces.join("\n").trim();
    const policy = getToolPolicy(mcp, tool);

    // 2. Compute signals (§4, §5, §10.5)
    // Una señal textual solo es fiable en un resultado de error o cuando el texto EMPIEZA con el marcador explícito
    // (así los emiten los adaptadores). En un resultado exitoso el texto es dato (archivos, páginas, búsquedas):
    // que contenga "not found", "access denied" o "timeout" no describe cómo terminó la herramienta.
    const lowerText = fullText.toLowerCase();
    const leadsWith = (marker: string) => fullText.startsWith(marker);
    const isNotFound =
      leadsWith("[NOT_FOUND]") ||
      (isError && (fullText.includes("[NOT_FOUND]") || lowerText.includes("not found") || /\benoent\b|no such file or directory/.test(lowerText)));
    const isDenied =
      leadsWith("[DENIED]") || (isError && (fullText.includes("[DENIED]") || lowerText.includes("access denied")));

    // La vacuidad de `free_search:search` se decide en su rama (necesita el recuento y los resultados leídos).
    const emptyOutput = policy.emptyIsError === true && fullText.length === 0;

    const signals: StepExecutionSignals = {
      exit_code: typeof mergedData.exit_code === "number" ? mergedData.exit_code : (isError ? 1 : undefined),
      exception: isError && !isNotFound && !isDenied,
      timeout: Boolean(mergedData.timed_out || (isError && /timeout/i.test(fullText))),
      not_found: isNotFound,
      denied: isDenied,
      empty_output: emptyOutput,
    };

    // 3. Store full result in task-isolated RefStore (§10.4)
    let refKey: string | undefined;
    if (fullText.length > 0) {
      refKey = RefStore.put(fullText, taskId, refLabel(tool, args));
    }

    // 4. Deterministic Extractors per Tool (§10.5)
    // Un resultado de error no pasa por los extractores específicos (producirían un resumen de éxito y facts
    // de una ruta, URL o PID que no se obtuvo): usa el extractor genérico, cuyo resumen es la primera línea del error.
    const input: ExtractorInput = { mcp, tool, args, isError, success, fullText, mergedData, refKey };
    let extracted: ExtractorOutput;
    if (!isError && tool === "list_directory") {
      extracted = extractListDirectory(input);
    } else if (!isError && tool === "read_file") {
      extracted = extractReadFile(input);
    } else if (!isError && tool.includes("process")) {
      extracted = extractProcess(input);
    } else if (!isError && mcp === "free_search" && tool === "search") {
      extracted = extractSearch(input);
    } else if (!isError && mcp === "free_search" && tool === "fetch") {
      extracted = extractFetch(input);
    } else {
      extracted = extractGeneric(input);
    }
    const { finding, compactObs } = extracted;
    Object.assign(factsDelta, extracted.factsDelta);
    Object.assign(scratchpadDelta, extracted.scratchpadDelta);
    Object.assign(signals, extracted.signals);

    // 5. Determine VerificationState
    let verification: VerificationState = "NOT_REQUIRED";
    if (success && !isError && !signals.empty_output && !signals.not_found) {
      verification = "VERIFIED";
    }

    // 6. Evidence object
    const evidence: Evidence = {
      ok: success && !isError && !signals.empty_output && !signals.not_found,
      summary: finding,
      obs: compactObs ? compactObs.slice(0, MAX_EVIDENCE_OBS_CHARS) : undefined,
      flags: flags.length > 0 ? flags : undefined,
      ref: evidenceRef(mcp, tool, refKey),
    };

    // 7. Resumen estructurado para modelos clasificadores (Decision 2.0)
    let decisionSummary: string;
    if (signals.not_found) {
      decisionSummary = `[NOT FOUND] ${tool}: ${finding}. Resource not found.`;
    } else if (signals.empty_output) {
      decisionSummary = `[EMPTY] ${tool}: ${finding}. The output contains no useful data.`;
    } else if (isError || (signals.exit_code !== undefined && signals.exit_code !== 0) || signals.denied) {
      decisionSummary = `[FAILURE] ${tool}: ${finding || 'Execution error'}.`;
    } else if (success) {
      decisionSummary = `[SUCCESS] ${tool}: ${finding}. Information obtained and stored in memory.`;
    } else {
      decisionSummary = `[INFO] ${tool}: ${finding}.`;
    }

    return {
      outcome,
      evidence,
      verification,
      scratchpadDelta,
      summaryText: finding,
      finding,
      compactObs,
      factsDelta,
      signals,
      refKey,
      decisionSummary,
    };
  }
}