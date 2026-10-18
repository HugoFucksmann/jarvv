import type {
  MCPCallResult,
  Evidence,
  VerificationState,
  ExecutionOutcome,
  Scratchpad,
  StepExecutionSignals,
} from "../types.ts";
import { MAX_SCRATCHPAD_RESULTS } from "../types.ts";
import { getToolPolicy } from "../tools/manifest.ts";

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

/**
 * Task-isolated reference store for complete tool outputs (§10.4, §10.11).
 * Isolates data per taskId to prevent cross-task clearing and memory leaks.
 */
/** Descripción de una referencia guardada: origen legible y tamaño (para el bloque REFS del prompt de argumentos). */
export interface RefDescriptor {
  key: string;
  label: string;
  chars: number;
}

/** Referencia completa, tal como se entrega al archivador al liberar una tarea. */
export interface RefEntry {
  key: string;
  label: string;
  content: string;
}

export class RefStore {
  private static archiver?: (taskId: string, refs: RefEntry[]) => void;
  private static taskStores: Map<string, Map<string, string>> = new Map();
  private static taskCounters: Map<string, number> = new Map();
  private static taskMeta: Map<string, Map<string, { label: string; chars: number }>> = new Map();

  static put(content: string, taskId: string = "default", label?: string): string {
    let store = this.taskStores.get(taskId);
    if (!store) {
      store = new Map<string, string>();
      this.taskStores.set(taskId, store);
    }
    const currentCounter = (this.taskCounters.get(taskId) || 0) + 1;
    this.taskCounters.set(taskId, currentCounter);
    const key = `r${currentCounter}`;
    store.set(key, content);
    let meta = this.taskMeta.get(taskId);
    if (!meta) {
      meta = new Map();
      this.taskMeta.set(taskId, meta);
    }
    meta.set(key, { label: label ?? "", chars: content.length });
    return key;
  }

  /** Las últimas `limit` referencias de la tarea, de la más antigua a la más reciente. */
  static describe(taskId: string, limit = 5): RefDescriptor[] {
    const meta = this.taskMeta.get(taskId);
    if (!meta) return [];
    return Array.from(meta.entries())
      .slice(-limit)
      .map(([key, m]) => ({ key, label: m.label, chars: m.chars }));
  }

  static get(key: string, taskId?: string): string | undefined {
    if (taskId) {
      return this.taskStores.get(taskId)?.get(key);
    }
    for (const store of this.taskStores.values()) {
      const val = store.get(key);
      if (val !== undefined) return val;
    }
    return undefined;
  }

  static has(key: string, taskId?: string): boolean {
    return this.get(key, taskId) !== undefined;
  }

  static list(taskId: string): string[] {
    const store = this.taskStores.get(taskId);
    return store ? Array.from(store.keys()) : [];
  }

  /** Registra quién archiva las referencias de una tarea al liberarlas (lo cablea el núcleo; evita acoplar este módulo a disco). */
  static setArchiver(fn?: (taskId: string, refs: RefEntry[]) => void): void {
    this.archiver = fn;
  }

  /**
   * Libera las referencias de una tarea en memoria, archivándolas antes si hay archivador: la evidencia de una tarea
   * terminada debe seguir consultable desde el historial. Sin referencias no hace nada (no pisa un archivo existente).
   */
  static clear(taskId?: string): void {
    if (taskId) {
      this.archive(taskId);
      this.discard(taskId);
    } else {
      this.taskStores.clear();
      this.taskCounters.clear();
      this.taskMeta.clear();
    }
  }

  /** Descarta las referencias de una tarea en memoria SIN archivarlas (tarea expulsada del historial). */
  static discard(taskId: string): void {
    this.taskStores.delete(taskId);
    this.taskCounters.delete(taskId);
    this.taskMeta.delete(taskId);
  }

  private static archive(taskId: string): void {
    const store = this.taskStores.get(taskId);
    if (!store || store.size === 0 || !this.archiver) return;
    const meta = this.taskMeta.get(taskId);
    try {
      this.archiver(
        taskId,
        Array.from(store.entries()).map(([key, content]) => ({ key, label: meta?.get(key)?.label ?? "", content }))
      );
    } catch (err) {
      console.warn(`[RefStore] No se pudieron archivar las referencias de '${taskId}':`, err);
    }
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
    .replace(/\b(GOAL|FACTS|LOG|FAIL|TASK|PLAN|CHAT|SCHEMA|TOOL|REFS|EFFECTS|LAST):/gi, "$1_")
    .trim();
  if (clean.length > maxLen) {
    clean = clean.substring(0, maxLen - 3) + "...";
  }
  return clean;
}

/** Argumentos que mejor identifican de dónde viene un resultado (para describirlo en REFS). */
const REF_LABEL_ARGS = ["path", "file_path", "url", "query", "command", "pattern", "name"] as const;

function refLabel(tool: string, args: Record<string, unknown>): string {
  for (const key of REF_LABEL_ARGS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return `${tool} ${sanitizeForMemory(value, 60)}`;
  }
  return tool;
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
    taskId?: string
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
    const policy = getToolPolicy(mcp, tool);

    // 2. Compute signals (§4, §5, §10.5)
    // Una señal textual solo es fiable en un resultado de error o cuando el texto EMPIEZA con el marcador explícito
    // (así los emiten los adaptadores). En un resultado exitoso el texto es dato (archivos, páginas, búsquedas):
    // que contenga "not found", "access denied" o "timeout" no describe cómo terminó la herramienta.
    const lowerText = fullText.toLowerCase();
    const leadsWith = (marker: string) => fullText.startsWith(marker);
    const isNotFound =
      leadsWith("[NOT_FOUND]") || (isError && (fullText.includes("[NOT_FOUND]") || lowerText.includes("not found")));
    const isDenied =
      leadsWith("[DENIED]") || (isError && (fullText.includes("[DENIED]") || lowerText.includes("access denied")));

    let emptyOutput = false;
    if (policy.emptyIsError) {
      if (!fullText || fullText.length === 0) {
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
    let finding = "";
    let compactObs = "";

    if (!isError && tool === "list_directory") {
      const lines = fullText.split("\n").filter((l) => l.trim().length > 0);
      finding = sanitizeForMemory(`${lines.length} entradas en directorio`);
      const top40 = lines.slice(0, 40).join("\n");
      compactObs = top40 || "Directorio vacío.";
      if (lines.length > 40 && refKey) {
        compactObs += `\n[... ${lines.length - 40} entradas omitidas, ref:${refKey}]`;
      }
    } else if (!isError && tool === "read_file") {
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
    } else if (!isError && tool.includes("process")) {
      // Desktop Commander no devuelve pid ni exit code estructurados. Formatos reales (MCP_REAL_OUTPUTS):
      //   start_process       primera línea: "Process started with PID <n> (shell: ...)"; última: "✅ Process <n> has finished execution" (si terminó)
      //   read_process_output última línea:   "✅ Process completed with exit code <n> (runtime: ...)" (si terminó)
      // Solo se leen la primera y la última línea: el cuerpo es salida del proceso y no es fiable.
      const textLines = fullText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      const firstTextLine = textLines[0] ?? "";
      const lastTextLine = textLines[textLines.length - 1] ?? "";
      const textPid = /^Process started with PID (\d+)\b/.exec(firstTextLine)?.[1];
      const textExit = /Process completed with exit code (-?\d+)\b/.exec(lastTextLine)?.[1];
      const finished = /Process \d+ has finished execution$/.test(lastTextLine);

      const pid = mergedData.process_id || mergedData.pid || args.pid || args.process_id || textPid;
      if (pid) {
        factsDelta.pid = String(pid);
        scratchpadDelta.process_id = String(pid);
      }

      let knownExit: number | undefined;
      if (typeof mergedData.exit_code === "number") {
        knownExit = mergedData.exit_code;
      } else if (textExit !== undefined) {
        knownExit = parseInt(textExit, 10);
        signals.exit_code = knownExit;
      }
      const processStatus = knownExit !== undefined ? `exit=${knownExit}` : finished ? "status=finished" : "status=running";
      finding = sanitizeForMemory(`pid=${pid || 'desconocido'}, ${processStatus}`);
      const lines = fullText.split("\n");
      const tail = lines.slice(-30).join("\n");
      compactObs = tail || `Proceso ${pid} ejecutado.`;
      if (lines.length > 30 && refKey) {
        compactObs = `[... salida previa omitida, ref:${refKey}]\n` + compactObs;
      }
    } else if (!isError && mcp === "free_search" && tool === "search") {
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

        // El scratchpad es estado visible/persistido, no contexto de modelo: se acota para no crecer sin límite.
        scratchpadDelta.search_results = items.slice(0, MAX_SCRATCHPAD_RESULTS).map((r) => ({
          ...r,
          snippet: typeof r.snippet === "string" ? r.snippet.slice(0, 300) : r.snippet,
        }));
        scratchpadDelta.search_results_total = items.length;

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
    } else if (!isError && mcp === "free_search" && tool === "fetch") {
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
    } else {
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
    let decisionSummary: string;
    if (signals.not_found) {
      decisionSummary = `[NOT FOUND] ${tool}: ${finding}. Resource not found.`;
    } else if (signals.empty_output) {
      decisionSummary = `[EMPTY] ${tool}: ${finding}. The output contains no useful data.`;
    } else if (isError || signals.exit_code !== 0 || signals.denied) {
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