/**
 * Proveedor nativo `jarvis_web`: la tool `web_search`.
 *
 * Busca en internet (o lee las URL dadas) y devuelve SOLO los fragmentos que responden la pregunta, literales y con su fuente. Las páginas completas no llegan al contexto:
 * van enteras en `raw` (la ref en disco) y el modelo ve `text`.
 *
 * Pipeline: obtener el material con \`research\` (o \`fetch\` por URL) de Free Search, por el \`ToolHost\` → limpiar y partir en fragmentos → BM25 contra \`need\` y \`terms\`
 * (hasta 15 candidatos con cobertura mínima, máximo 3 por fuente, sin casi repetidos) → el modelo de decisión (2B), si se inyectó, puntúa cada candidato → el código arma el resultado con un estado calculado por umbrales.
 * No hay ningún modelo generativo: nadie redacta texto a partir de páginas no confiables, y lo único que sale de un fragmento hostil es una probabilidad.
 *
 * Estados (\`data.state\`): \`found\`, \`partial\`, \`not_found\` (se leyó material y nada responde) y \`no_results\` (no hubo material). Los dos últimos son "sin datos" para la
 * verificación; con filtros, antes de rendirse se repite UNA vez sin ellos.
 */

import { BUDGET } from "../../core/budget.ts";
import type { FragmentJudge } from "../../core/tools/judge.ts";
import type { ToolCallOptions, ToolProvider, ToolRef } from "../../core/tools/provider.ts";
import { toolResult } from "../../core/tools/result.ts";
import { clipAtWord } from "../../core/text.ts";
import type { MCPCallResult, MCPTool } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";
import { FRESHNESS, parseArgs, searchQuestion, type WebArgs } from "./args.ts";
import { CANDIDATES, pickCandidates, rank, type Ranked } from "./bm25.ts";
import { chunkDocs, snippetChunks } from "./chunks.ts";
import { parseFetch, parseResearch, type Doc, type Material, type Source } from "./report.ts";

export const WEB_SERVER = "jarvis_web";
export const WEB_SEARCH = "web_search";

/** Las herramientas de otro proveedor que usa por dentro: lo único que el `ToolHost` le deja llamar. */
export const WEB_DEPENDENCIES: readonly ToolRef[] = [
  { server: "free_search", tool: "research" },
  { server: "free_search", tool: "fetch" },
];

/** Antigüedad máxima de la caché de Free Search (por defecto guarda 7 días). */
export const DEFAULT_MAX_AGE_HOURS = 24;
/** Con modelo: probabilidad desde la que un fragmento responde (`found`) o responde en parte (`partial`). */
export const JUDGE_FOUND = 0.6;
export const JUDGE_PARTIAL = 0.3;
/** Sin modelo (o si falla): fracción de las palabras de la pregunta que debe tener el fragmento. Coincidir en palabras no es responder: sin modelo el estado no pasa de `partial`. */
export const COVERAGE_PARTIAL = 0.34;
/** Fragmentos que se devuelven como máximo, y caracteres que ocupan entre todos. */
export const RETURN_MAX = 4;
const PASSAGES_BUDGET = 1700;
const DEFAULT_TIMEOUT_MS = 150_000;
const DEFAULT_JUDGE_TIMEOUT_MS = 20_000;
const SAFETY_MARGIN_MS = 5000;
/** Tiempo que debe quedar para el reintento sin filtros y para el modelo. */
const RETRY_NEEDS_MS = 30_000;
const JUDGE_NEEDS_MS = 15_000;
const SOURCES_LISTED = 5;
const TRACE_RAW_MAX = 20_000;

type State = "found" | "partial" | "not_found" | "no_results";

const TOOL: MCPTool = {
  name: WEB_SEARCH,
  description: "Search the web, or read given URLs, and return the relevant passages.",
  inputSchema: {
    type: "object",
    properties: {
      need: { type: "string", description: "The question to answer, in natural language (max 300 characters)." },
      terms: { type: "array", items: { type: "string" }, description: "Optional keywords in the language the sources are likely written in." },
      urls: { type: "array", items: { type: "string" }, description: "Optional pages to read directly instead of searching (max 5)." },
      freshness: { type: "string", enum: [...FRESHNESS], description: "Only for time-sensitive needs." },
      domains: { type: "array", items: { type: "string" }, description: "Only if the user named a site." },
    },
    required: ["need"],
    additionalProperties: false,
  },
};

/** Cómo dice Free Search que la búsqueda no encontró nada (lo informa como error de herramienta). */
const NO_RESULTS = /\bno (?:results?|sources?|matches|pages?|documents?)\b|\bnothing (?:was )?found\b|\b0 (?:results|sources)\b/i;

/** Marca de un extracto del buscador en `text`: el modelo debe saber que no es texto de la página (puede estar desactualizado). */
const SNIPPET_MARK = "(search result snippet) ";

const passageOf =(c: Ranked): Passage => ({ n: c.chunk.n, text: c.chunk.text, score: c.score, ...(c.chunk.kind === "snippet" ? { snippet: true } : {}) });

const fail = (message: string): MCPCallResult => toolResult({ text: message, raw: message, data: { state: "error" }, isError: true });

interface Passage {
  readonly n: number;
  readonly text: string;
  readonly score: number;
  readonly probability?: number;
  /** El extracto del buscador, no texto de la página. */
  readonly snippet?: boolean;
}

interface Analysis {
  readonly state: State;
  readonly passages: readonly Passage[];
  readonly candidates: number;
  readonly judge: "off" | "used" | "failed";
  readonly judgeMeta: Record<string, unknown>;
}

interface Gathered {
  readonly material: Material;
  /** Texto completo de lo obtenido (va a la ref). */
  readonly raw: string;
  readonly errors: string[];
  /** Free Search falló por algo que no es "sin resultados" (caída, bloqueo, plazo): con este motivo, no hay datos no es lo mismo que no se pudo buscar. */
  readonly unavailable?: string;
}

export interface WebSearchOptions {
  /** Cliente del modelo de decisión para puntuar fragmentos; se consulta en cada llamada (la configuración puede cambiar). Sin él, solo BM25. */
  readonly judge?: () => FragmentJudge | undefined;
  readonly maxAgeHours?: number;
  /** Plazo máximo del modelo en una búsqueda (por defecto 20 s); pasado ese plazo se sigue con el orden léxico. */
  readonly judgeTimeoutMs?: number;
}

const textOf = (result: MCPCallResult): string =>
  result.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim();

export class WebSearchProvider implements ToolProvider {
  readonly name = WEB_SERVER;
  readonly version = "1.0.0";
  readonly dependencies = WEB_DEPENDENCIES;
  private readonly getJudge: () => FragmentJudge | undefined;
  private readonly maxAgeHours: number;
  private readonly judgeTimeoutMs: number;

  constructor(options: WebSearchOptions = {}) {
    this.getJudge = options.judge ?? (() => undefined);
    this.maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
    this.judgeTimeoutMs = options.judgeTimeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;
  }

  async listTools(): Promise<MCPTool[]> {
    return [TOOL];
  }

  isConnected(): boolean {
    return true;
  }

  async reconnect(): Promise<void> {}

  async callTool(name: string, args: Record<string, unknown>, options: ToolCallOptions = {}): Promise<MCPCallResult> {
    if (name !== WEB_SEARCH) return fail(`Unknown tool: '${name}'.`);
    if (options.host === undefined) return fail("web_search only runs inside a task: it needs the tool host.");
    const parsed = parseArgs(args);
    if (!parsed.ok) return fail(parsed.message);
    // La pregunta sin la orden que la envuelve ("Buscá en internet…"): es lo que va al buscador, a BM25 y al juez; `meta` guarda las dos.
    const query: WebArgs = { ...parsed.args, need: searchQuestion(parsed.args.need) };

    const started = Date.now();
    const deadline = started + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) - SAFETY_MARGIN_MS;
    const remaining = (): number => deadline - Date.now();
    const timings: Record<string, number> = {};
    const host = options.host;
    const signal = options.signal;

    let filtered = parsed.args.freshness !== undefined || parsed.args.domains.length > 0;
    let retried = false;
    let gathered: Gathered;
    let analysis: Analysis;
    try {
      let mark = Date.now();
      gathered = await this.gather(host, query, filtered, signal);
      timings.fetchMs = Date.now() - mark;
      if (gathered.material.docs.length === 0 && gathered.errors.length > 0 && parsed.args.urls.length > 0) {
        return fail(`None of the URLs could be read: ${gathered.errors.join("; ")}`);
      }
      mark = Date.now();
      analysis = await this.analyze(query, gathered.material, remaining, signal);
      timings.rankMs = Date.now() - mark;

      // Sin resultado y con filtros: una sola vez más, sin ellos (si queda tiempo).
      if ((analysis.state === "not_found" || analysis.state === "no_results") && filtered && parsed.args.urls.length === 0 && remaining() > RETRY_NEEDS_MS) {
        retried = true;
        filtered = false;
        mark = Date.now();
        const again = await this.gather(host, query, false, signal);
        timings.retryFetchMs = Date.now() - mark;
        const second = await this.analyze(query, again.material, remaining, signal);
        if (second.state === "found" || second.state === "partial" || again.material.docs.length > gathered.material.docs.length) {
          gathered = { ...again, errors: [...gathered.errors, ...again.errors] };
          analysis = second;
        }
      }
      // Sin material porque Free Search falló (no porque no haya resultados): es un fallo de la herramienta, no "no hay datos".
      if (analysis.state === "no_results" && gathered.unavailable !== undefined) return fail(`The search service failed: ${gathered.unavailable}`);
    } catch (error) {
      if (signal?.aborted) return toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled" } });
      return fail(`Web search failed: ${errorMessage(error)}`);
    }

    return this.compose(parsed.args, query.need, gathered, analysis, { retried, timings, durationMs: Date.now() - started });
  }

  // ───────────────────────── Obtener el material ─────────────────────────

  private async gather(host: NonNullable<ToolCallOptions["host"]>, args: WebArgs, withFilters: boolean, signal?: AbortSignal): Promise<Gathered> {
    const errors: string[] = [];
    if (args.urls.length > 0) {
      // Las URL se leen a la vez (son independientes); el número de cada fuente es su posición en la lista, y el orden del resultado no depende de cuál responde antes.
      const unique = [...new Set(args.urls)];
      const pages = await Promise.all(
        unique.map(async (url, i): Promise<{ page?: { source: Source; doc: Doc }; text?: string; error?: string }> => {
          try {
            // La misma antigüedad máxima de la caché que `research` (sin ella, `fetch` usa la de Free Search: 7 días).
            const result = await host.call({ server: "free_search", tool: "fetch" }, { url, max_age_hours: this.maxAgeHours }, { signal });
            const text = textOf(result);
            if (result.isError === true) return { error: `${url}: ${clipAtWord(text || "error", 120)}` };
            const page = parseFetch(text, url, i + 1);
            return page === null ? { error: `${url}: empty page` } : { page, text };
          } catch (error) {
            if (signal?.aborted) throw error;
            return { error: `${url}: ${errorMessage(error)}` };
          }
        }),
      );
      const sources: Source[] = [];
      const docs: Doc[] = [];
      const raws: string[] = [];
      for (const r of pages) {
        if (r.error !== undefined) errors.push(r.error);
        if (r.page === undefined) continue;
        sources.push(r.page.source);
        docs.push(r.page.doc);
        raws.push(r.text ?? "");
      }
      return { material: { sources, docs }, raw: raws.join("\n\n---\n\n"), errors };
    }

    const request: Record<string, unknown> = { question: args.need, max_age_hours: this.maxAgeHours };
    if (withFilters && args.freshness !== undefined) request.freshness = args.freshness;
    if (withFilters && args.domains.length > 0) request.include_domains = args.domains;
    const result = await host.call({ server: "free_search", tool: "research" }, request, { signal });
    const text = textOf(result);
    if (result.isError === true) {
      // Free Search informa "sin resultados" como error de herramienta; el resto de sus errores (caída, bloqueo, plazo) es no haber podido buscar.
      const message = clipAtWord(text || "research failed", 200);
      errors.push(message);
      return { material: { sources: [], docs: [] }, raw: text, errors, ...(NO_RESULTS.test(text) ? {} : { unavailable: message }) };
    }
    return { material: parseResearch(text), raw: text, errors };
  }

  // ───────────────────────── Analizar ─────────────────────────

  private async analyze(args: WebArgs, material: Material, remaining: () => number, signal?: AbortSignal): Promise<Analysis> {
    // Sin páginas pero con extractos (Free Search no pudo leer ninguna), los extractos solos todavía pueden responder.
    const pages = chunkDocs(material.docs);
    const chunks = [...pages, ...snippetChunks(material.sources, pages.length)];
    if (material.docs.length === 0 && chunks.length === 0) return { state: "no_results", passages: [], candidates: 0, judge: "off", judgeMeta: {} };
    const { ranked } = rank(chunks, args.need, args.terms);
    const candidates = pickCandidates(ranked, CANDIDATES);
    if (candidates.length === 0) return { state: "not_found", passages: [], candidates: 0, judge: "off", judgeMeta: { chunks: chunks.length } };

    const judge = this.getJudge();
    if (judge !== undefined && remaining() > JUDGE_NEEDS_MS) {
      // El modelo no puede gastar más que el tiempo que queda: pasado ese plazo se sigue con el orden léxico.
      const bounded = AbortSignal.any([AbortSignal.timeout(Math.min(Math.max(remaining() - 2000, 1000), this.judgeTimeoutMs)), ...(signal === undefined ? [] : [signal])]);
      try {
        const scores = await judge.score(args.need, candidates.map((c) => c.chunk.text), bounded);
        if (scores.probabilities.length === candidates.length) {
          const scored = candidates
            .map((c, i) => ({ c, p: scores.probabilities[i] }))
            .sort((a, b) => b.p - a.p || b.c.score - a.c.score);
          const best = scored[0].p;
          const state: State = best >= JUDGE_FOUND ? "found" : best >= JUDGE_PARTIAL ? "partial" : "not_found";
          return {
            state,
            passages: scored.filter((s) => s.p >= JUDGE_PARTIAL).slice(0, RETURN_MAX).map((s) => ({ ...passageOf(s.c), probability: s.p })),
            candidates: candidates.length,
            judge: "used",
            judgeMeta: {
              durationMs: scores.durationMs,
              probabilities: scores.probabilities.map((p) => Number(p.toFixed(3))),
              rawInput: scores.rawInput.slice(0, TRACE_RAW_MAX),
              rawOutput: scores.rawOutput.slice(0, TRACE_RAW_MAX),
            },
          };
        }
        return this.byCoverage(candidates, "failed", { error: "el modelo no devolvió una probabilidad por fragmento" });
      } catch (error) {
        if (signal?.aborted) throw error; // cancelación de la tarea (no el plazo del modelo)
        return this.byCoverage(candidates, "failed", { error: errorMessage(error) });
      }
    }
    return this.byCoverage(candidates, "off", {});
  }

  /** Estado y fragmentos por cobertura de palabras (sin modelo, o con el modelo caído): coincidir en palabras no es responder, así que nunca `found`. */
  private byCoverage(candidates: readonly Ranked[], judge: "off" | "failed", judgeMeta: Record<string, unknown>): Analysis {
    // El estado lo decide cualquier candidato que llegue al umbral, no solo el primero (el orden es por puntaje, no por cobertura).
    const passages = candidates
      .filter((c) => c.coverage >= COVERAGE_PARTIAL)
      .slice(0, RETURN_MAX)
      .map(passageOf);
    return { state: passages.length > 0 ? "partial" : "not_found", passages, candidates: candidates.length, judge, judgeMeta };
  }

  // ───────────────────────── Armar el resultado ─────────────────────────

  private compose(args: WebArgs, question: string, gathered: Gathered, analysis: Analysis, info: { retried: boolean; timings: Record<string, number>; durationMs: number }): MCPCallResult {
    const sourceOf = new Map(gathered.material.sources.map((s) => [s.n, s]));
    const sourceLine = (n: number): string => {
      const s = sourceOf.get(n);
      return s === undefined ? `[${n}]` : `[${n}] ${clipAtWord(s.title, 90)} — ${s.url}${s.date === undefined ? "" : ` (published ${s.date})`}`;
    };

    // Los fragmentos que caben en el presupuesto, en el orden de relevancia; siempre entra el primero (si no cabe entero, se recorta).
    const shown: Passage[] = [];
    let used = 0;
    for (const p of analysis.passages) {
      const overhead = 6 + (p.snippet === true ? SNIPPET_MARK.length : 0);
      const cost = p.text.length + overhead;
      if (shown.length > 0 && used + cost > PASSAGES_BUDGET) continue;
      shown.push(shown.length === 0 && cost > PASSAGES_BUDGET ? { ...p, text: clipAtWord(p.text, PASSAGES_BUDGET - overhead) } : p);
      used += cost;
    }
    const warnings = gathered.material.format === "unrecognized" ? ["Free Search answered in an unrecognized format: sources, titles and dates could not be read."] : [];

    const cited = [...new Set(shown.map((p) => p.n))];
    const listed = analysis.state === "found" || analysis.state === "partial" ? cited : gathered.material.sources.slice(0, SOURCES_LISTED).map((s) => s.n);
    const lines: string[] = [];
    switch (analysis.state) {
      case "found":
      case "partial":
        lines.push(`status: ${analysis.state} · ${shown.length} passage${shown.length === 1 ? "" : "s"} from ${cited.length} source${cited.length === 1 ? "" : "s"}`);
        if (analysis.state === "partial") {
          lines.push(
            analysis.judge === "used"
              ? "Only part of the question may be answered by these passages."
              : "These passages match the keywords of the question; check that they really answer it.",
          );
        }
        lines.push(...shown.map((p) => `[${p.n}] ${p.snippet === true ? SNIPPET_MARK : ""}${p.text}`));
        break;
      case "not_found":
        lines.push(`status: not_found · no passage answers the question (${gathered.material.sources.length || gathered.material.docs.length} sources read)`);
        break;
      case "no_results":
        lines.push("status: no_results · nothing was found for this search");
        if (gathered.errors.length > 0) lines.push(`(${gathered.errors[0]})`);
        break;
    }
    if (listed.length > 0) lines.push("Sources:", ...listed.map(sourceLine));
    const text = lines.join("\n");

    return toolResult({
      text,
      raw: gathered.raw,
      data: {
        state: analysis.state,
        passages: shown.map((p) => ({
          n: p.n,
          score: Number(p.score.toFixed(3)),
          ...(p.probability === undefined ? {} : { probability: Number(p.probability.toFixed(3)) }),
          ...(p.snippet === true ? { snippet: true } : {}),
        })),
        sources: gathered.material.sources.map((s) => ({ n: s.n, title: s.title, url: s.url, ...(s.date === undefined ? {} : { date: s.date }) })),
        candidates: analysis.candidates,
        judge: analysis.judge,
        retried: info.retried,
      },
      meta: {
        need: args.need,
        ...(question === args.need ? {} : { question }),
        terms: args.terms,
        filters: { freshness: args.freshness ?? null, domains: args.domains },
        maxAgeHours: this.maxAgeHours,
        durationMs: info.durationMs,
        timings: info.timings,
        judge: { mode: analysis.judge, ...analysis.judgeMeta },
        errors: gathered.errors,
        warnings,
        budget: BUDGET.summaryMax,
      },
    });
  }
}
