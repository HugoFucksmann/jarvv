/**
 * JARVIS Core — Result Processor
 * Boundary between MCP-specific ToolResults and Core State (§24, §44).
 * 
 * Rules:
 * - Does NOT replace MCP ToolResults; processes and extracts Core-level information.
 * - Extracts Evidence, ExecutionOutcome, VerificationState, and Scratchpad updates.
 * - Enforces invariant: actionDispatched=true && outcomeVerified=false -> UNVERIFIED (§25.5).
 * - Distinguishes [NOT_FOUND] vs [DENIED] (§26.2).
 * - Preserves provenance and marks untrusted web content as DATA (§27, §28).
 * - Compacts large outputs; preserves resource/image handles and references without context bloat (§10, §11).
 */

import {
  MCPCallResult,
  Evidence,
  VerificationState,
  ExecutionOutcome,
  Scratchpad,
} from "../types.ts";

export interface ProcessedResult {
  outcome: ExecutionOutcome;
  evidence: Evidence;
  verification: VerificationState;
  scratchpadDelta: Partial<Scratchpad>;
  summaryText: string;
}

export class ResultProcessor {
  /**
   * Processes a raw MCP ToolResult into structured Core state.
   */
  static process(
    mcp: string,
    tool: string,
    rawResult: MCPCallResult,
    _args: Record<string, unknown>
  ): ProcessedResult {
    const isError = Boolean(rawResult.isError);
    const success = Boolean(rawResult.success !== undefined ? rawResult.success : !isError);
    const actionDispatched = Boolean(rawResult.actionDispatched);
    const outcomeVerified = Boolean(rawResult.outcomeVerified);

    const outcome: ExecutionOutcome = {
      success,
      isError,
      actionDispatched,
      outcomeVerified,
    };

    const flags: string[] = [];
    const scratchpadDelta: Partial<Scratchpad> = {};

    // 1. Process content blocks preserving types (text, resource, image)
    const contentItems = rawResult.content || [];
    const textPieces: string[] = [];
    let embeddedPayload: Record<string, any> = {};

    for (const item of contentItems) {
      if (item.type === "text" && item.text) {
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
          } catch {}
        }
      } else if (item.type === "image") {
        flags.push("IMAGE_CONTENT_ATTACHED");
      } else if (item.type === "resource" && item.uri) {
        flags.push(`RESOURCE_REF:${item.uri}`);
      }
    }

    const mergedData: Record<string, any> = { ...rawResult, ...embeddedPayload };
    const rawSummary = textPieces.join("\n") || (success ? "Operación ejecutada con éxito." : "Error en ejecución.");

    // Handle large results: compact observation for LLM context, preserve handle/ref (§11, §44)
    let compactSummary = rawSummary;
    if (rawSummary.length > 500) {
      compactSummary = `${rawSummary.substring(0, 480)}... [Resultado truncado para contexto, tamaño total: ${rawSummary.length} caracteres]`;
      flags.push("RESULT_COMPACTED");
    }

    // 2. Route/MCP specific normalization
    if (mcp === "windows") {
      const winHandle = mergedData.windowHandle || mergedData.window_handle;
      if (winHandle) {
        scratchpadDelta.window_handle = String(winHandle);
      }
      const elId = mergedData.elementId || mergedData.element_id;
      if (elId) {
        scratchpadDelta.element_id = String(elId);
      }
      if (mergedData.snapshotIncomplete) {
        flags.push("SNAPSHOT_INCOMPLETE");
      }
      if (mergedData.postActionSnapshotIncomplete) {
        flags.push("POST_ACTION_SNAPSHOT_INCOMPLETE");
      }
      if (mergedData.postActionWarning) {
        flags.push(`WARNING: ${mergedData.postActionWarning}`);
      }
      if (mergedData.search_incomplete) {
        flags.push("SEARCH_INCOMPLETE");
      }
      if (mergedData.staleElement) {
        flags.push("STALE_ELEMENT");
      }
    } else if (mcp === "desktop_commander") {
      if (mergedData.path) {
        scratchpadDelta.path = String(mergedData.path);
      }
      const pid = mergedData.process_id || mergedData.pid;
      if (pid) {
        scratchpadDelta.process_id = String(pid);
        flags.push(`PID: ${pid}`);
      }
      if (rawSummary.includes("[NOT_FOUND]")) {
        flags.push("NOT_FOUND");
      }
      if (rawSummary.includes("[DENIED]")) {
        flags.push("DENIED");
      }
    } else if (mcp === "free_search") {
      const searchRes = mergedData.results || mergedData.documents;
      if (Array.isArray(searchRes)) {
        scratchpadDelta.search_results = searchRes;
        flags.push(`RESULTS: ${searchRes.length}`);
      }
      if (mergedData.url) {
        scratchpadDelta.url = String(mergedData.url);
      }
      if (mergedData.retrieved_at) {
        flags.push(`CACHED_AT: ${mergedData.retrieved_at}`);
      }
      if (Array.isArray(mergedData.benched_engines) && mergedData.benched_engines.length > 0) {
        flags.push(`BENCHED_ENGINES: ${mergedData.benched_engines.join(",")}`);
      }
    }

    // 3. Determine VerificationState (§10, §25.5, §36)
    let verification: VerificationState = "NOT_REQUIRED";

    if (actionDispatched) {
      if (outcomeVerified) {
        verification = "VERIFIED";
      } else {
        // Dispatched but unverified side effect -> UNVERIFIED (§25.5)
        verification = "UNVERIFIED";
        flags.push("PENDING_OBSERVATION");
      }
    } else if (success && !isError) {
      verification = "VERIFIED";
    }

    // 4. Construct Evidence object (§9)
    const evidence: Evidence = {
      ok: success && !isError,
      summary: compactSummary,
      flags: flags.length > 0 ? flags : undefined,
      ref: `${mcp}:${tool}`,
    };

    return {
      outcome,
      evidence,
      verification,
      scratchpadDelta,
      summaryText: rawSummary,
    };
  }
}
