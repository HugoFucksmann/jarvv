/**
 * JARVIS Core — Extractores de free_search (búsqueda web y páginas)
 */

import type { ExtractorInput, ExtractorOutput } from "./types.ts";
import type { Scratchpad, StepExecutionSignals } from "../../types.ts";
import { MAX_EVIDENCE_OBS_CHARS, MAX_SCRATCHPAD_RESULTS } from "../../types.ts";
import { sanitizeForMemory, clipAtWord, headTail, LONG_OBS_CHARS } from "../text.ts";

/** Largos de snippet que intenta la observación compacta de `search`, de mayor a menor: gana el mayor que quepa. */
const SEARCH_SNIPPET_LENGTHS = [240, 160, 100, 60, 40] as const;

/** Línea con la que `search` informa un motor inexistente: `- <motor>: Unknown engine: '<x>'.` */
const UNKNOWN_ENGINE_LINE = /^- [^:\n]+: Unknown engine: '([^']+)'\./gm;

interface SearchItem {
    title: string;
    url?: string;
    snippet?: string;
    /** Fecha AAAA-MM-DD que la herramienta le asignó al resultado; ausente si es `undated`. */
    date?: string;
}

/**
 * Observación compacta de `search` dentro de MAX_EVIDENCE_OBS_CHARS. Prioridad: título y URL de cada resultado
 * (siempre completos); después los snippets, del mayor largo que quepa en todos; el lead, solo si cabe. Si ni los títulos y
 * URLs entran, se conservan los resultados completos que caben y el resto queda en la referencia.
 */
function buildSearchObs(
    items: readonly SearchItem[],
    leadText: string | undefined,
    refKey: string | undefined,
    datedNote?: string
): string {
    const shown = items.slice(0, MAX_SCRATCHPAD_RESULTS);
    const bare = shown.map((it) => `${it.url ? `${it.title}: ${it.url}` : it.title}${it.date ? ` [${it.date}]` : ""}`);
    const withSnippets = (n: number) =>
        shown.map((it, i) => (it.snippet ? `${bare[i]} - ${clipAtWord(it.snippet, n)}` : bare[i]));
    const lead = leadText ? `Lead: ${leadText.slice(0, 300)}` : undefined;

    const compose = (lines: readonly string[], withLead: boolean): string => {
        const omitted = items.length - lines.length;
        const note = omitted > 0 && refKey ? `\n[... omitidos ${omitted} resultados, ref:${refKey}]` : "";
        return [...(datedNote ? [datedNote] : []), ...(withLead && lead ? [lead] : []), ...lines].join("\n") + note;
    };

    for (const n of SEARCH_SNIPPET_LENGTHS) {
        const lines = withSnippets(n);
        const plain = compose(lines, false);
        if (plain.length <= MAX_EVIDENCE_OBS_CHARS) {
            const withLead = compose(lines, true);
            return withLead.length <= MAX_EVIDENCE_OBS_CHARS ? withLead : plain;
        }
    }
    const bareObs = compose(bare, false);
    if (bareObs.length <= MAX_EVIDENCE_OBS_CHARS) return bareObs;

    let kept = Math.max(bare.length - 1, 1);
    while (kept > 1 && compose(bare.slice(0, kept), false).length > MAX_EVIDENCE_OBS_CHARS) kept--;
    return compose(bare.slice(0, kept), false);
}

/** `free_search:search`: resultados web leídos del Markdown del servidor. */
export function extractSearch({ isError, success, fullText, refKey }: ExtractorInput): ExtractorOutput {
    const scratchpadDelta: Partial<Scratchpad> = {};
    const signals: Partial<StepExecutionSignals> = {};
    let finding = "";
    let compactObs = "";
    // Jarvis nunca pide `format: "json"` (el manifest limita `search` a query y max_results): el servidor responde
    // Markdown (MCP_REAL_OUTPUTS §2.1). Cabecera con `_results: N_`, lead opcional y una sección "## n. título" por resultado.
    const items: SearchItem[] = [];
    let leadText: string | undefined;

    const resultsMatch = fullText.match(/_results:\s*(\d+)_/i);
    const reportedCount = resultsMatch ? parseInt(resultsMatch[1], 10) : undefined;

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
        const snippet = snippetMatch ? snippetMatch[1].replace(/\n>\s*/g, " ").trim() : undefined;

        // Línea de metadatos de la herramienta: `_motores_ · score 0.03 · 2026-10-16 (from snippet text)` o `· undated`.
        const dateMatch = sec.match(/·\s*score\s*[\d.]+\s*·\s*(\d{4}-\d{2}-\d{2})/i);
        items.push({ title, url, snippet, date: dateMatch?.[1] });
    }

    // Sin resultados leídos: `_results: 0_`, o un texto corto sin ese marcador, es una búsqueda vacía. Un recuento
    // positivo, o un texto largo sin marcador, es un formato que no se supo leer.
    const reportedPositive = reportedCount !== undefined && reportedCount > 0;
    const longWithoutMarker = reportedCount === undefined && fullText.length > 500;
    if (items.length === 0 && (reportedPositive || longWithoutMarker)) {
        const firstLine = fullText.split("\n")[0] || (success ? "Operación exitosa" : "Fallo en tool");
        finding = sanitizeForMemory(isError ? `err: ${firstLine}` : firstLine);
        if (fullText.length > LONG_OBS_CHARS) {
            compactObs = headTail(fullText, refKey);
        } else {
            compactObs = fullText || "Búsqueda web completada.";
        }
    } else if (items.length === 0) {
        signals.empty_output = true;
        const unknownEngines = [...fullText.matchAll(UNKNOWN_ENGINE_LINE)].map((m) => m[1]);
        finding = sanitizeForMemory(
            unknownEngines.length > 0 ? `0 resultados web (motor desconocido: ${unknownEngines.join(", ")})` : "0 resultados web"
        );
        compactObs = "0 resultados encontrados.";
    } else {
        const count = reportedCount !== undefined ? reportedCount : items.length;
        // Hallazgo neutral: no nombra ningún resultado (el orden es por relevancia, no por fecha). `_dated: n/m_` es el
        // recuento que informa la herramienta (MCP_REAL_OUTPUTS §2.1); si falta, no se inventa.
        const datedMatch = fullText.match(/_dated:\s*(\d+)\/(\d+)_/i);
        finding = sanitizeForMemory(`${count} resultados web${datedMatch ? ` (${datedMatch[1]} con fecha)` : ""}`);

        // Estado visible de la UI. Ya no es un "hecho": las URLs completas viajan en DATA/LAST.
        if (items[0]?.url) scratchpadDelta.url = items[0].url;

        // El scratchpad es estado visible, no contexto de modelo: se acota para no crecer sin límite.
        scratchpadDelta.search_results = items.slice(0, MAX_SCRATCHPAD_RESULTS).map((r) => ({
            ...r,
            snippet: typeof r.snippet === "string" ? r.snippet.slice(0, 300) : r.snippet,
        }));
        scratchpadDelta.search_results_total = items.length;

        compactObs = buildSearchObs(
            items,
            leadText,
            refKey,
            datedMatch ? `Con fecha: ${datedMatch[1]}/${datedMatch[2]} (el resto, sin fecha)` : undefined
        );
    }
    return { finding, compactObs, scratchpadDelta, signals };
}

/** `free_search:fetch`: la URL como hecho y el inicio de la página. */
export function extractFetch({ args, fullText, mergedData, refKey }: ExtractorInput): ExtractorOutput {
    const factsDelta: Record<string, string> = {};
    const scratchpadDelta: Partial<Scratchpad> = {};
    let finding = "";
    let compactObs = "";
    const urlStr = String(mergedData.url || args.url || "");
    if (urlStr) {
        factsDelta.url = urlStr;
        scratchpadDelta.url = urlStr;
    }
    const firstLine = fullText.split("\n")[0] || "Página web";
    finding = sanitizeForMemory(`página: ${firstLine}`);
    if (fullText.length > LONG_OBS_CHARS) {
        compactObs = headTail(fullText, refKey, "contenido omitido");
    } else {
        compactObs = fullText || "Página web leída.";
    }
    return { finding, compactObs, factsDelta, scratchpadDelta };
}