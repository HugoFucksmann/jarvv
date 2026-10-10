import {
  MCPCallResult,
  Evidence,
  VerificationState,
  ExecutionOutcome,
  Scratchpad,
  StepExecutionSignals,
} from "../types.ts";
import { PolicyRegistry } from "../policy/policyRegistry.ts";

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
  decisionSummary: string; // Resumen estructurado para modelos clasificadores (Decision 2.0)
}

/**
 * Volatile reference store for complete tool outputs (§10.4, §10.11)
 * Discarded when task ends.
 */
export class RefStore {
  private static storeMap: Map<string, string> = new Map();
  private static counter = 0;

  static put(content: string): string {
    this.counter++;
    const key = `r${this.counter}`;
    this.storeMap.set(key, content);
    return key;
  }

  static get(key: string): string | undefined {
    return this.storeMap.get(key);
  }

  static clear(): void {
    this.storeMap.clear();
    this.counter = 0;
  }
}

/**
 * Sanitizes external text to a single line, stripping control chars and escaping delimiters (§10.7)
 */
export function sanitizeForMemory(text: string, maxLen = 120): string {
  if (!text) return "";
  let clean = text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/<\/?obs>/gi, "[obs]")
    .replace(/\b(GOAL|FACTS|LOG|FAIL|TASK|PLAN|CHAT|SCHEMA|TOOL):/gi, "$1_")
    .trim();
  if (clean.length > maxLen) {
    clean = clean.substring(0, maxLen - 3) + "...";
  }
  return clean;
}

export class ResultProcessor {
  /**
   * Processes a raw MCP ToolResult into structured Core state and memory tokens.
   */
  static process(
    mcp: string,
    tool: string,
    rawResult: MCPCallResult,
    args: Record<string, unknown> = {}
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
    const policy = PolicyRegistry.getPolicy(mcp, tool);

    // 2. Compute signals (§4, §5, §10.5)
    const isNotFound = fullText.includes("[NOT_FOUND]") || fullText.toLowerCase().includes("not found");
    const isDenied = fullText.includes("[DENIED]") || fullText.toLowerCase().includes("access denied");

    // empty_output is calculated ONLY for read/search tools (§4, §10.5)
    let emptyOutput = false;
    if (policy.emptyIsError) {
      if (!fullText || fullText.length === 0) {
        emptyOutput = true;
      } else if (tool === "search_files" && /0\s+(matches|coincidencias|archivos)/i.test(fullText)) {
        emptyOutput = true;
      } else if (mcp === "free_search") {
        if (tool === "search") {
          const resultsMatch = fullText.match(/_results:\s*(\d+)_/i);
          if (resultsMatch) {
            emptyOutput = parseInt(resultsMatch[1], 10) === 0;
          } else if (/0\s+(results|resultados)/i.test(fullText) && fullText.length < 500) {
            emptyOutput = true;
          } else if (fullText.length < 50) {
            emptyOutput = true;
          }
        } else {
          if (fullText.length < 50) {
            emptyOutput = true;
          }
        }
      }
    }

    const signals: StepExecutionSignals = {
      exit_code: typeof mergedData.exit_code === "number" ? mergedData.exit_code : (isError ? 1 : 0),
      exception: isError && !isNotFound && !isDenied,
      timeout: Boolean(mergedData.timed_out || /timeout/i.test(fullText)),
      not_found: isNotFound,
      denied: isDenied,
      unverified: actionDispatched && !outcomeVerified,
      empty_output: emptyOutput,
    };

    // 3. Store full result in RefStore (§10.4)
    let refKey: string | undefined;
    if (fullText.length > 0) {
      refKey = RefStore.put(fullText);
    }

    // 4. Deterministic Extractors per Tool (§10.5)
    let finding = "";
    let compactObs = "";

    // Specific extractor: UI tree (windows: ui_get_window_tree, ui_get_diff_tree)
    if (tool.includes("tree") || tool.includes("window_tree")) {
      const winHandle = mergedData.windowHandle || mergedData.window_handle || args.window_handle;
      if (winHandle) {
        scratchpadDelta.window_handle = String(winHandle);
        factsDelta.win = String(winHandle);
      }
      const elId = mergedData.elementId || mergedData.element_id;
      if (elId) {
        scratchpadDelta.element_id = String(elId);
        factsDelta.el = String(elId);
      }
      const tree = Array.isArray(mergedData.tree) ? mergedData.tree : [];
      const count = tree.length > 0 ? tree.length : (fullText.split("\n").length);
      const inc = mergedData.snapshotIncomplete ? " (incompleto)" : "";
      finding = sanitizeForMemory(`Ventana: ${winHandle || 'activa'}, ${count} elementos${inc}`);

      const lines = fullText.split("\n").filter((l) => l.trim().length > 0);
      const interactive = lines.slice(0, 30).join("\n");
      compactObs = interactive || "Árbol de UI inspeccionado.";
      if (lines.length > 30 && refKey) {
        compactObs += `\n[... omitidos ${lines.length - 30} elementos, ref:${refKey}]`;
      }
    }
    // Specific extractor: search_files
    else if (tool === "search_files") {
      const lines = fullText.split("\n").filter((l) => l.trim().length > 0);
      const count = lines.length;
      const firstLine = lines[0] || "";
      const firstMatch = firstLine.split(":")[0]?.trim() || firstLine;
      finding = sanitizeForMemory(`${count} coincidencias, primera: ${firstMatch}`);
      if (firstMatch) {
        factsDelta.path = firstMatch;
        scratchpadDelta.path = firstMatch;
      }
      const candidates = lines.slice(0, 5).map((l) => l.split(":")[0].trim()).filter(Boolean);
      if (candidates.length > 0) {
        factsDelta.cand = candidates.join(", ");
      }
      const top10 = lines.slice(0, 10).map((l) => l.substring(0, 100)).join("\n");
      compactObs = top10 || "Sin coincidencias.";
      if (lines.length > 10 && refKey) {
        compactObs += `\n[... ${lines.length - 10} coincidencias omitidas, ref:${refKey}]`;
      }
    }
    // Specific extractor: list_directory
    else if (tool === "list_directory") {
      const lines = fullText.split("\n").filter((l) => l.trim().length > 0);
      finding = sanitizeForMemory(`${lines.length} entradas en directorio`);
      const top40 = lines.slice(0, 40).join("\n");
      compactObs = top40 || "Directorio vacío.";
      if (lines.length > 40 && refKey) {
        compactObs += `\n[... ${lines.length - 40} entradas omitidas, ref:${refKey}]`;
      }
    }
    // Specific extractor: read_file
    else if (tool === "read_file") {
      const lines = fullText.split("\n");
      const sizeBytes = Buffer.byteLength(fullText, "utf-8");
      const sizeKb = (sizeBytes / 1024).toFixed(1);
      finding = sanitizeForMemory(`${lines.length} líneas, ${sizeKb}KB`);
      if (args.path) {
        factsDelta.path = String(args.path);
        scratchpadDelta.path = String(args.path);
      }
      if (lines.length > 30) {
        const head = lines.slice(0, 15).join("\n");
        const tail = lines.slice(-15).join("\n");
        compactObs = `${head}\n[... ${lines.length - 30} líneas omitidas, ref:${refKey}]\n${tail}`;
      } else {
        compactObs = fullText || "Archivo leído (vacío).";
      }
    }
    // Specific extractor: start_process, interact_process, read_process_output
    else if (tool.includes("process")) {
      const pid = mergedData.process_id || mergedData.pid || args.pid || args.process_id;
      if (pid) {
        factsDelta.pid = String(pid);
        scratchpadDelta.process_id = String(pid);
      }
      const exitCode = mergedData.exit_code ?? (isError ? "error" : "running");
      finding = sanitizeForMemory(`pid=${pid || 'desconocido'}, status=${exitCode}`);
      const lines = fullText.split("\n");
      const tail = lines.slice(-30).join("\n");
      compactObs = tail || `Proceso ${pid} ejecutado.`;
      if (lines.length > 30 && refKey) {
        compactObs = `[... salida previa omitida, ref:${refKey}]\n` + compactObs;
      }
    }
    // Specific extractor: search (web)
    else if (mcp === "free_search" && tool === "search") {
      let jsonResults = Array.isArray(mergedData.results) ? mergedData.results : (Array.isArray(mergedData.documents) ? mergedData.documents : null);

      let items: { title: string; url?: string; snippet?: string }[] = [];
      let reportedCount: number | undefined;
      let leadText: string | undefined;

      if (jsonResults && jsonResults.length > 0) {
        items = jsonResults.map((r: any) => ({
          title: r.title || "Resultado",
          url: r.url,
          snippet: r.snippet || r.description,
        }));
        reportedCount = items.length;
      } else {
        const resultsMatch = fullText.match(/_results:\s*(\d+)_/i);
        if (resultsMatch) {
          reportedCount = parseInt(resultsMatch[1], 10);
        }

        const leadMatch = fullText.match(/>\s*\*\*Lead:\*\*\s*([^\n]+(?:\n>[^\n]+)*)/i);
        if (leadMatch) {
          leadText = leadMatch[1].replace(/\n>\s*/g, " ").trim();
        }

        const sections = fullText.split(/\n(?=##\s*\d+\.\s*)/);
        for (const sec of sections) {
          const headerMatch = sec.match(/^##\s*\d+\.\s*([^\n]+)/);
          if (!headerMatch) continue;
          const title = headerMatch[1].trim();

          const urlMatch = sec.match(/<([^>]+)>/) || sec.match(/\n(https?:\/\/[^\s\n]+)/);
          const url = urlMatch ? urlMatch[1].trim() : undefined;

          const snippetMatch = sec.match(/(?:^|\n)>\s*(?!\*\*Lead:\*\*)([^\n]+(?:\n>[^\n]+)*)/);
          let snippet: string | undefined;
          if (snippetMatch) {
            snippet = snippetMatch[1].replace(/\n>\s*/g, " ").trim();
          }

          items.push({ title, url, snippet });
        }
      }

      if (items.length === 0 && ((reportedCount !== undefined && reportedCount > 0) || fullText.length > 500)) {
        signals.empty_output = false;
        const firstLine = fullText.split("\n")[0] || (success ? "Operación exitosa" : "Fallo en tool");
        finding = sanitizeForMemory(`${isError ? 'err' : 'ok'}: ${firstLine}`);
        if (fullText.length > 1500) {
          compactObs = `${fullText.substring(0, 750)}\n[... omitidos, ref:${refKey}]\n${fullText.substring(fullText.length - 750)}`;
        } else {
          compactObs = fullText || "Búsqueda web completada.";
        }
      } else if (items.length === 0 && (reportedCount === 0 || fullText.length < 50)) {
        signals.empty_output = true;
        finding = sanitizeForMemory(`0 resultados web`);
        compactObs = "0 resultados encontrados.";
      } else {
        const count = reportedCount !== undefined ? reportedCount : items.length;
        const firstTitle = items[0]?.title || "";
        finding = sanitizeForMemory(`${count} resultados web, primero: ${firstTitle}`);

        if (items[0]?.url) {
          factsDelta.url = items[0].url;
          scratchpadDelta.url = items[0].url;
        }

        const cands = items.slice(0, 5).map((r) => r.url).filter(Boolean);
        if (cands.length > 0) {
          factsDelta.cand = cands.join(", ");
        }

        scratchpadDelta.search_results = items;

        const obsLines: string[] = [];
        if (leadText) {
          obsLines.push(`Lead: ${leadText.slice(0, 300)}`);
        }
        for (const it of items.slice(0, 5)) {
          const snip = it.snippet ? ` - ${it.snippet.slice(0, 150)}` : "";
          obsLines.push(`${it.title}: ${it.url || ""} ${snip}`.trim());
        }
        let formattedObs = obsLines.join("\n") || "Búsqueda web completada.";
        if (items.length > 5 && refKey) {
          formattedObs += `\n[... omitidos ${items.length - 5} resultados, ref:${refKey}]`;
        }
        compactObs = formattedObs;
      }
    }
    // Specific extractor: research (web)
    else if (mcp === "free_search" && tool === "research") {
      const firstHeaderMatch = fullText.match(/^#+\s*([^\n]+)/m);
      const firstLine = firstHeaderMatch ? firstHeaderMatch[1].trim() : (fullText.split("\n")[0] || "Reporte de investigación");
      finding = sanitizeForMemory(`reporte: ${firstLine}`);
      if (fullText.length > 1500) {
        compactObs = `${fullText.substring(0, 1500)}\n[... reporte continúa, ref:${refKey}]`;
      } else {
        compactObs = fullText || "Reporte de investigación generado.";
      }
    }
    // Specific extractor: fetch_page (web)
    else if (mcp === "free_search" && tool === "fetch_page") {
      const urlStr = String(mergedData.url || args.url || "");
      if (urlStr) {
        factsDelta.url = urlStr;
        scratchpadDelta.url = urlStr;
      }
      const firstLine = fullText.split("\n")[0] || "Página web";
      finding = sanitizeForMemory(`página: ${firstLine}`);
      if (fullText.length > 1500) {
        compactObs = `${fullText.substring(0, 750)}\n[... contenido omitido, ref:${refKey}]\n${fullText.substring(fullText.length - 750)}`;
      } else {
        compactObs = fullText || "Página web leída.";
      }
    }
    // Generic extractor: any other tool
    else {
      const firstLine = fullText.split("\n")[0] || (success ? "Operación exitosa" : "Fallo en tool");
      finding = sanitizeForMemory(`${isError ? 'err' : 'ok'}: ${firstLine}`);
      if (fullText.length > 1500) {
        compactObs = `${fullText.substring(0, 750)}\n[... omitidos, ref:${refKey}]\n${fullText.substring(fullText.length - 750)}`;
      } else {
        compactObs = fullText || (success ? "Operación completada sin salida." : "Error de ejecución.");
      }
    }

    // 5. Determine VerificationState (§10, §25.5, §36)
    let verification: VerificationState = "NOT_REQUIRED";
    if (actionDispatched) {
      if (outcomeVerified) {
        verification = "VERIFIED";
      } else {
        verification = "UNVERIFIED";
        flags.push("PENDING_OBSERVATION");
      }
    } else if (success && !isError) {
      verification = "VERIFIED";
    }

    // 6. Evidence object
    const evidence: Evidence = {
      ok: success && !isError && !signals.empty_output && !signals.not_found,
      summary: finding,
      obs: compactObs ? compactObs.slice(0, 1500) : undefined,
      flags: flags.length > 0 ? flags : undefined,
      ref: refKey ? `${mcp}:${tool}:${refKey}` : `${mcp}:${tool}`,
    };

    // 7. Resumen estructurado para modelos clasificadores (Decision 2.0)
    let decisionSummary = "";
    if (signals.not_found) {
      decisionSummary = `[SIN RESULTADOS] ${mcp}/${tool}: ${finding}. Recurso no encontrado.`;
    } else if (signals.empty_output) {
      decisionSummary = `[VACÍO] ${mcp}/${tool}: ${finding}. La salida no contiene datos útiles.`;
    } else if (isError || signals.exit_code !== 0 || signals.denied) {
      decisionSummary = `[FALLO] ${mcp}/${tool}: ${finding || 'Error en ejecución'}.`;
    } else if (success && !isError) {
      decisionSummary = `[ÉXITO] ${mcp}/${tool}: ${finding}. Información obtenida y registrada en memoria.`;
    } else {
      decisionSummary = `[INFO] ${mcp}/${tool}: ${finding}.`;
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