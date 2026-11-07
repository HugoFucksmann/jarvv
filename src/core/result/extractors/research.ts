import type { ExtractorInput, ExtractorOutput } from "./types.ts";
import { BUDGET } from "../../budget.ts";
import { clipAtWord, omissionMarker, stemsOf } from "../../text.ts";
import { compactText } from "./shared.ts";

/**
 * `free_search:research`: el "Research brief" del servidor (índice de fuentes y, después, el texto completo de cada página).
 *
 * El extractor genérico dejaba el principio y el final del conjunto: los snippets de las dos primeras fuentes y la cola de
 * la última página, sin nada del centro de las páginas, que es donde está la información (y los modelos contestaban de eso).
 * Este arma el resumen con lo que decide una respuesta, sin modelos y dentro de `BUDGET.summaryMax`:
 *   1. el pedido y el recuento de fuentes;
 *   2. TODAS las fuentes con título, URL, fecha y snippet (los snippets, del mayor largo que quepa en todas);
 *   3. con el espacio que queda, las líneas de las páginas que más se parecen a la pregunta, marcadas con la fuente de la
 *      que salen. Se parecen = comparten palabras de la pregunta (por prefijo de 5 letras, sin acentos: sirve en español e
 *      inglés sin listas por idioma), contando más las que traen una fecha o un número.
 * Las filas de tabla no compiten (muchas filas parecidas no dicen nada); el resto de cada página queda en la ref.
 */

const EVIDENCE_MIN_CHARS = 700;
const EVIDENCE_LINE_MAX = 240;
const MAX_EVIDENCE_LINES = 7;
const PER_SOURCE_LINES = 2;
/** La segunda línea de una fuente entra solo si su puntaje es al menos esta fracción del mejor de todos. */
const SECOND_LINE_RATIO = 0.6;

/** Palabras sueltas de 3 letras o más que no distinguen una pregunta de otra (español e inglés). */
const STOP = new Set(
    "que cual cuales como donde cuando para por con una uno unos unas del los las sus sobre hay esta este ese esa son ser the and for with what which how are you was this that from has have about into".split(
        " "
    )
);

const stems = (text: string): Set<string> => stemsOf(text, STOP);

interface Source {
    n: number;
    title: string;
    url: string;
    date?: string;
    snippet?: string;
}

interface Doc {
    url: string;
    body: string[];
}

function parseSources(block: string): Source[] {
    const sources: Source[] = [];
    let cur: Source | undefined;
    for (const line of block.split("\n")) {
        const head = line.match(/^- \[(\d+)\]\s+\*\*(.+?)\*\*\s+—\s+<([^>]+)>/);
        if (head) {
            cur = { n: Number(head[1]), title: head[2].trim(), url: head[3].trim() };
            sources.push(cur);
            continue;
        }
        if (!cur) continue;
        const date = line.match(/_published\s+(\d{4}-\d{2}-\d{2})/);
        if (date && !cur.date) cur.date = date[1];
        const snippet = line.match(/^\s+>\s*(.+)$/);
        if (snippet && !cur.snippet) cur.snippet = snippet[1].trim();
    }
    return sources;
}

function parseDocs(block: string): Doc[] {
    const docs: Doc[] = [];
    let cur: Doc | undefined;
    for (const line of block.split("\n")) {
        const head = line.match(/^<(https?:\/\/[^>]+)>\s+·\s+~\d+\s+tokens\s*$/);
        if (head) {
            cur = { url: head[1], body: [] };
            docs.push(cur);
        } else if (cur) {
            cur.body.push(line);
        }
    }
    return docs;
}

interface Candidate {
    n: number;
    order: number;
    score: number;
    text: string;
}

/** Líneas de una página que se parecen a la pregunta, de la más parecida a la menos. */
function evidenceOf(n: number, body: readonly string[], question: ReadonlySet<string>): Candidate[] {
    const out: Candidate[] = [];
    body.forEach((raw, order) => {
        // Los destinos de los enlaces (`[texto](url)`) no son texto de la página y coinciden con cualquier palabra de la pregunta.
        const line = raw.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
        if (line.startsWith("|") || line === "---") return;
        const heading = line.startsWith("#");
        const text = heading ? line.replace(/^#+\s*/, "") : line;
        // Un título corto con una palabra de la pregunta (p. ej. "Qué aporta GPT-6.1 Terra") sirve; una línea corriente, no.
        if (text.length < (heading ? 12 : 40)) return;
        const shared = [...stems(text)].filter((s) => question.has(s)).length;
        // Con una pregunta de pocas palabras alcanza una coincidencia; con más, hacen falta dos (a un título, una).
        if (shared < (heading ? 1 : Math.min(2, question.size))) return;
        // Una línea con un año vale más que una de prosa genérica: la prosa "insignia" de una página de catálogo suele estar desactualizada.
        const score = shared * (heading ? 0.8 : 1) + (/\d/.test(text) ? 0.25 : 0) + (/\b20\d\d\b/.test(text) ? 1.5 : 0);
        out.push({ n, order, score, text: clipAtWord(text.replace(/[*_`]/g, ""), EVIDENCE_LINE_MAX) });
    });
    return out.sort((a, b) => b.score - a.score || a.order - b.order);
}

export function extractResearch({ fullText, args }: ExtractorInput): ExtractorOutput {
    const sourcesAt = fullText.indexOf("## Sources");
    if (!fullText.startsWith("# Research brief") || sourcesAt < 0) return compactText(fullText);

    const docsAt = fullText.indexOf("\n## Documents");
    const sources = parseSources(fullText.slice(sourcesAt, docsAt < 0 ? undefined : docsAt));
    const docs = docsAt < 0 ? [] : parseDocs(fullText.slice(docsAt));
    if (sources.length === 0 && docs.length === 0) return compactText(fullText);

    const header = fullText.split("\n", 1)[0].replace(/^#\s*Research brief:\s*/, "");
    const question = (typeof args.question === "string" && args.question.trim() ? args.question : header).trim();
    const tokens = fullText.match(/_engines:[^_]*·\s*sources:\s*(\d+)\s*·\s*~(\d+)\s*tokens_/);
    const top = `Research: ${clipAtWord(question, 140)} · ${sources.length} fuentes${tokens ? ` · ~${tokens[2]} tokens` : ""}`;

    const cap = BUDGET.summaryMax;
    const sourceLine = (s: Source, snippetChars: number): string =>
        `[${s.n}] ${clipAtWord(s.title, 90)}: ${s.url}${s.date ? ` [${s.date}]` : ""}${snippetChars > 0 && s.snippet ? ` - ${clipAtWord(s.snippet, snippetChars)}` : ""}`;

    // Fuentes: del mayor largo de snippet que deje lugar para las líneas de las páginas.
    let sourceLines = sources.map((s) => sourceLine(s, 0));
    for (const n of [220, 160, 110, 70, 0]) {
        const lines = sources.map((s) => sourceLine(s, n));
        if (top.length + lines.join("\n").length + 20 + EVIDENCE_MIN_CHARS <= cap) {
            sourceLines = lines;
            break;
        }
    }

    // Líneas de las páginas: las mejores de cada fuente, y de ahí las más parecidas que quepan, en el orden de las fuentes.
    const question$ = stems(question);
    const byN = new Map(sources.map((s) => [s.url, s.n]));
    const perDoc = docs.map((doc, i) => evidenceOf(byN.get(doc.url) ?? i + 1, doc.body, question$).slice(0, PER_SOURCE_LINES));
    const best = Math.max(0, ...perDoc.map((list) => list[0]?.score ?? 0));
    // La mejor línea de cada fuente siempre; la segunda, solo si casi iguala a la mejor de todas (prosa genérica no desplaza a los datos).
    const picked = perDoc.flatMap((list) => list.filter((c, i) => i === 0 || c.score >= SECOND_LINE_RATIO * best));
    picked.sort((a, b) => b.score - a.score || a.n - b.n || a.order - b.order);

    const budget = (): number => cap - (top.length + sourceLines.join("\n").length + 60);
    const chosen: Candidate[] = [];
    let used = 0;
    for (const c of picked) {
        if (chosen.length >= MAX_EVIDENCE_LINES) break;
        const cost = c.text.length + 6;
        if (used + cost > budget()) continue;
        chosen.push(c);
        used += cost;
    }
    chosen.sort((a, b) => a.n - b.n || a.order - b.order);

    const parts = [top, "Fuentes:", ...sourceLines];
    if (chosen.length > 0) parts.push("Extractos de las páginas:", ...chosen.map((c) => `[${c.n}] ${c.text}`));
    const bodyChars = docs.reduce((a, d) => a + d.body.join("\n").length, 0);
    const shown = chosen.reduce((a, c) => a + c.text.length, 0);
    const omitted = Math.max(0, bodyChars - shown);
    if (omitted > 0) parts.push(omissionMarker(omitted, "caracteres de las páginas"));

    const summary = parts.join("\n");
    return { summary: summary.length <= cap ? summary : summary.slice(0, cap), truncated: omitted > 0 };
}
