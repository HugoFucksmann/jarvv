import type { ExtractorInput, ExtractorOutput } from "./types.ts";
import { BUDGET } from "../../budget.ts";
import { clipAtWord, omissionMarker } from "../../text.ts";
import { compactText } from "./shared.ts";

/** Líneas con las que `search` informa un motor inexistente: `- <motor>: Unknown engine: '<x>'.` */
const UNKNOWN_ENGINE_LINES = /^- [^:\n]+: Unknown engine: '[^']+'\..*$/gm;

interface SearchItem {
    title: string;
    url?: string;
    snippet?: string;
    /** Fecha AAAA-MM-DD que la herramienta le asignó al resultado; ausente si es `undated`. */
    date?: string;
}

interface SearchObs {
    text: string;
    /** `true` si se omitió un resultado, parte de un snippet o del lead (metadatos como `score` no cuentan). */
    truncated: boolean;
}

/**
 * Resumen de `search` dentro de `BUDGET.summaryMax`. Prioridad: título y URL de cada resultado (siempre completos);
 * después los snippets, del mayor largo que quepa en todos; el lead, solo si cabe. Si ni los títulos y URLs entran, se
 * conservan los resultados completos que caben; el resto lo recupera la ref (el marcador no la nombra). `truncated`
 * dice si el resumen dejó fuera contenido del resultado.
 */
function buildSearchObs(items: readonly SearchItem[], leadText: string | undefined, datedNote?: string): SearchObs {
    const { searchResultsShown, searchSnippetLengths, searchLeadChars } = BUDGET.extract;
    const cap = BUDGET.summaryMax;
    const shown = items.slice(0, searchResultsShown);
    const bare = shown.map((it) => `${it.url ? `${it.title}: ${it.url}` : it.title}${it.date ? ` [${it.date}]` : ""}`);
    const withSnippets = (n: number) =>
        shown.map((it, i) => (it.snippet ? `${bare[i]} - ${clipAtWord(it.snippet, n)}` : bare[i]));
    const lead = leadText ? `Lead: ${leadText.slice(0, searchLeadChars)}` : undefined;
    const leadCut = leadText !== undefined && leadText.length > searchLeadChars;

    const compose = (lines: readonly string[], withLead: boolean): string => {
        const omitted = items.length - lines.length;
        const note = omitted > 0 ? `\n${omissionMarker(omitted, "resultados")}` : "";
        return [...(datedNote ? [datedNote] : []), ...(withLead && lead ? [lead] : []), ...lines].join("\n") + note;
    };

    // ¿Quedó fuera contenido? Resultados no mostrados, snippets más largos que el largo elegido (`null` = sin
    // snippets) o un lead ausente o recortado.
    const lostContent = (count: number, snippetCap: number | null, withLead: boolean): boolean => {
        const resultsOmitted = items.length > count;
        const snippetsCut = shown
            .slice(0, count)
            .some((it) => Boolean(it.snippet) && (snippetCap === null || (it.snippet as string).length > snippetCap));
        const leadLost = leadText !== undefined && (!withLead || leadCut);
        return resultsOmitted || snippetsCut || leadLost;
    };

    for (const n of searchSnippetLengths) {
        const lines = withSnippets(n);
        const plain = compose(lines, false);
        if (plain.length <= cap) {
            const withLead = compose(lines, true);
            const useLead = withLead.length <= cap;
            return { text: useLead ? withLead : plain, truncated: lostContent(lines.length, n, useLead) };
        }
    }
    const bareObs = compose(bare, false);
    if (bareObs.length <= cap) return { text: bareObs, truncated: lostContent(bare.length, null, false) };

    let kept = Math.max(bare.length - 1, 1);
    while (kept > 1 && compose(bare.slice(0, kept), false).length > cap) kept--;
    return { text: compose(bare.slice(0, kept), false), truncated: lostContent(kept, null, false) };
}

/** `free_search:search`: resultados web leídos del Markdown del servidor. */
export function extractSearch({ fullText }: ExtractorInput): ExtractorOutput {
    // Jarvis nunca pide `format: "json"` (el manifest limita `search` a query y max_results): el servidor responde
    // Markdown, con cabecera `_results: N_`, un lead opcional y una sección "## n. título" por resultado.
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
        return compactText(fullText);
    }
    if (items.length === 0) {
        // Búsqueda vacía: el `status` (`no_data`) basta. Solo se conserva lo que explica la causa, si la hay: los
        // motores que el servidor no conoce.
        const unknownEngines = fullText.match(UNKNOWN_ENGINE_LINES) ?? [];
        return {
            summary: unknownEngines.length > 0 ? unknownEngines.join("\n") : null,
            truncated: false,
            signals: { empty_output: true },
        };
    }

    // `_dated: n/m_` es el recuento que informa la herramienta; si falta, no se inventa.
    const datedMatch = fullText.match(/_dated:\s*(\d+)\/(\d+)_/i);
    const obs = buildSearchObs(
        items,
        leadText,
        datedMatch ? `Con fecha: ${datedMatch[1]}/${datedMatch[2]} (el resto, sin fecha)` : undefined
    );
    return { summary: obs.text, truncated: obs.truncated };
}

/** `free_search:fetch`: el inicio y el final de la página (la URL se deriva de `args`). */
export function extractFetch({ fullText }: ExtractorInput): ExtractorOutput {
    return compactText(fullText);
}
