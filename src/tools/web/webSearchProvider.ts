/**
 * Proveedor nativo `jarvis_web`: la tool `web_search`.
 *
 * Busca en internet (o lee las URL dadas) y devuelve SOLO los fragmentos que responden la pregunta, literales y con su fuente. Las páginas completas no llegan al contexto:
 * van enteras en `raw` (la ref en disco) y el modelo ve `text`.
 *
 * Pipeline: `search` de Free Search (en JSON, por el `ToolHost`) trae enlaces con extracto y fecha → el modelo de decisión (2B) puntúa los extractos (viendo la fecha de hoy y la de
 * cada fuente) → si alguno responde, se devuelve sin leer nada; si no, se lee UNA página (la del mejor extracto, con `fetch`), se parte en fragmentos, BM25 elige candidatos y el 2B
 * los puntúa; se repite hasta `pages` páginas. Sin modelo (o si falla): se leen las primeras páginas a la vez y BM25 ordena (el estado no pasa de `partial`). Con `urls` solo se leen
 * esas páginas. El código arma el resultado con un estado calculado por umbrales. Medido en scripts/validate/web_eval/RESULTADOS.md.
 * No hay ningún modelo generativo: nadie redacta texto a partir de páginas no confiables, y lo único que sale de un fragmento hostil es una probabilidad.
 *
 * Estados (`data.state`): `found`, `partial`, `not_found` (se leyó material y nada responde) y `no_results` (no hubo material). Los dos últimos son "sin datos" para la
 * verificación; con filtros, antes de rendirse se repite UNA vez sin ellos.
 */

import { BUDGET } from "../../core/budget.ts";
import type { FragmentJudge } from "../../core/tools/judge.ts";
import type { ToolCallOptions, ToolProvider, ToolRef } from "../../core/tools/provider.ts";
import { toolResult } from "../../core/tools/result.ts";
import { clipAtWord } from "../../core/text.ts";
import type { MCPCallResult, MCPTool } from "../../core/types.ts";
import { errorMessage } from "../../core/utils.ts";
import { FRESHNESS, MAX_DOMAINS, MAX_NEED_CHARS, MAX_URL_CHARS, MAX_URLS, isInternalHost, parseArgs, searchQuestion, type WebArgs } from "./args.ts";
import { CANDIDATES, PER_SOURCE, pickCandidates, rank, type Ranked } from "./bm25.ts";
import { chunkDocs, dateLabel, snippetChunks } from "./chunks.ts";
import { callWithDeadline, DeadlineError, FormatError, ToolBudgetError, toolBudgetMessage } from "./hostCall.ts";
import { parseFetch, parseReadDoc, parseSearch, type Doc, type Material, type Source } from "./report.ts";

export const WEB_SERVER = "jarvis_web";
export const WEB_SEARCH = "web_search";

/** Las herramientas de otro proveedor que usa por dentro: lo único que el `ToolHost` le deja llamar. */
export const WEB_DEPENDENCIES: readonly ToolRef[] = [
  { server: "free_search", tool: "search" },
  { server: "free_search", tool: "fetch" },
  { server: "free_search", tool: "read_doc" },
];

/** Antigüedad máxima de la caché de Free Search (por defecto guarda 7 días). */
export const DEFAULT_MAX_AGE_HOURS = 24;
/** Resultados que pide a `search` (los extractos se puntúan todos; las páginas se leen de a una). */
export const SEARCH_RESULTS = 8;
/** Páginas que se leen como máximo cuando ningún extracto responde (de a una, empezando por la del mejor extracto). Sin juez se leen las 3 primeras a la vez. */
export const DEFAULT_PAGES = 3;
/** Con modelo: probabilidad desde la que un fragmento responde (`found`) o responde en parte (`partial`). */
export const JUDGE_FOUND = 0.6;
export const JUDGE_PARTIAL = 0.3;
/** Sin modelo (o si falla): fracción de las palabras de la pregunta que debe tener el fragmento. Coincidir en palabras no es responder: sin modelo el estado no pasa de `partial`. */
export const COVERAGE_PARTIAL = 0.34;
/** Fragmentos que se devuelven como máximo, y caracteres que ocupan entre todos. */
export const RETURN_MAX = 4;
const PASSAGES_BUDGET = 1700;
export const DEFAULT_TIMEOUT_MS = 150_000;
const DEFAULT_JUDGE_TIMEOUT_MS = 20_000;
const SAFETY_MARGIN_MS = 5000;
/** Tiempo que debe quedar para el reintento sin filtros y para el modelo. */
const RETRY_NEEDS_MS = 30_000;
const JUDGE_NEEDS_MS = 15_000;
const SOURCES_LISTED = 5;
/** Extractos que se devuelven cuando ya responden (de fuentes distintas, con su fecha), y fragmentos de la página que responde. */
const SNIPPET_RETURN_MAX = 3;
const PAGE_RETURN_MAX = 3;
/** Fragmentos de una página que se puntúan. */
const PAGE_CANDIDATES = 6;
/**
 * Último recurso con una página que Free Search cortó (~50 000 caracteres): leer el resto con `read_doc` por tramos, a la vez (el documento completo sigue en su caché), y
 * puntuar más fragmentos. Solo corre cuando ya se iba a devolver `partial` o `not_found` con esa página cortada, así que no le suma latencia a lo que hoy responde.
 */
const FULL_READ_WINDOW = 50_000;
const FULL_READ_MAX_WINDOWS = 12;
const FULL_READ_NEEDS_MS = 45_000;
const FULL_PAGE_CANDIDATES = 12;
const TRACE_RAW_MAX = 20_000;

type State = "found" | "partial" | "not_found" | "no_results";

const TOOL: MCPTool = {
  name: WEB_SEARCH,
  // Las descripciones son las del manifiesto (`web_search` en `core/tools/manifest.ts`), que es la que ve el modelo: se mantienen iguales. Los límites son los de `parseArgs`.
  description: "Search the web, or read given URLs, and return the relevant passages.",
  inputSchema: {
    type: "object",
    properties: {
      need: { type: "string", maxLength: MAX_NEED_CHARS, description: "A direct question, e.g. 'When was Node.js 22 released?' (not an instruction like 'find…'; never a URL). Max 300 characters." },
      urls: { type: "array", maxItems: MAX_URLS, items: { type: "string", maxLength: MAX_URL_CHARS }, description: "Optional pages to read directly instead of searching (max 5, http or https)." },
      freshness: { type: "string", enum: [...FRESHNESS], description: "Only for time-sensitive needs: day, week, month or year." },
      domains: { type: "array", maxItems: MAX_DOMAINS, items: { type: "string" }, description: "Only if the user named a site: domains to restrict the search to (max 5)." },
    },
    required: ["need"],
    additionalProperties: false,
  },
};

/** Cómo dice Free Search que la búsqueda no encontró nada (lo informa como error de herramienta). */
const NO_RESULTS = /\bno (?:results?|sources?|matches|pages?|documents?)\b|\bnothing (?:was )?found\b|\b0 (?:results|sources)\b/i;

/** Marca de un extracto del buscador en `text`: el modelo debe saber que no es texto de la página (puede estar desactualizado). */
const SNIPPET_MARK = "(search result snippet) ";

const passageOf = (c: Ranked): Passage => ({ n: c.chunk.n, text: c.chunk.text, score: c.score, ...(c.chunk.kind === "snippet" ? { snippet: true } : {}) });

const fail = (message: string, data: Record<string, unknown> = {}, raw = message): MCPCallResult =>
  toolResult({ text: message, raw, data: { state: "error", ...data }, isError: true });

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

type Host = NonNullable<ToolCallOptions["host"]>;

interface PageRead {
  readonly page?: { source: Source; doc: Doc };
  readonly text?: string;
  readonly error?: string;
  readonly blocked?: boolean;
}

/** Un fragmento puntuado por el modelo (extracto del buscador o fragmento de página). */
interface Scored {
  n: number;
  text: string;
  snippet?: boolean;
  score: number;
  p: number;
}

const NO_RESULTS_ANALYSIS: Analysis = { state: "no_results", passages: [], candidates: 0, judge: "off", judgeMeta: {} };
const internalUrl = (url: string): boolean => {
  try {
    return isInternalHost(new URL(url).hostname);
  } catch {
    return true;
  }
};
/** Las versiones con puntos que nombra la pregunta (`22.0.0`, `3.12`): un pasaje que no las contiene habla de otra versión. */
const versionsOf = (need: string): string[] => [...new Set([...need.matchAll(/\d+(?:\.\d+)+/g)].map((m) => m[0]))];
/**
 * Guarda de versión: si la pregunta nombra una versión exacta y el pasaje no la contiene, el juez no puede afirmar que responde (un extracto de «Latest release 26.13.1 … 22: LTS»
 * se aprobó para «¿cuándo salió la 22.0.0?»). Se limita la probabilidad justo por debajo del umbral de `found`: queda como mucho `partial` y se sigue leyendo páginas.
 */
const guardVersions = (versions: readonly string[], text: string, p: number): number => (versions.every((v) => text.includes(v)) ? p : Math.min(p, JUDGE_FOUND - 0.01));
/** El fragmento con la fecha de su fuente delante: el juez la usa para distinguir lo reciente de lo viejo. */
const dated = (source: Source | undefined, text: string): string => `[source date: ${source?.date ?? "unknown"}] ${text}`;
/** `AAAA-MM-DD` en la zona horaria del sistema (la fecha que ve el usuario). */
const localDate = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Deadline {
  readonly signal?: AbortSignal;
  readonly deadline: number;
  readonly limitMs: number;
}

export interface WebSearchOptions {
  /** Cliente del modelo de decisión para puntuar fragmentos; se consulta en cada llamada (la configuración puede cambiar). Sin él, solo BM25. */
  readonly judge?: () => FragmentJudge | undefined;
  readonly maxAgeHours?: number;
  /** Páginas que se leen como máximo (entero de 1 a 8, por defecto 3). Una configuración inválida lanza al construir. No se expone al modelo. */
  readonly pages?: number;
  /** La fecha de hoy (el juez la ve para distinguir lo reciente); por defecto, la del sistema. */
  readonly now?: () => Date;
  /** Plazo máximo del modelo en una búsqueda (por defecto 20 s); pasado ese plazo se sigue con el orden léxico. */
  readonly judgeTimeoutMs?: number;
}

const EMPTY: Material = { sources: [], docs: [], blocked: 0, diagnostics: {} };

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
  private readonly pages: number;
  private readonly now: () => Date;
  private readonly judgeTimeoutMs: number;

  constructor(options: WebSearchOptions = {}) {
    this.getJudge = options.judge ?? (() => undefined);
    this.maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
    this.judgeTimeoutMs = options.judgeTimeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;
    const pages = options.pages ?? DEFAULT_PAGES;
    if (!Number.isInteger(pages) || pages < 1 || pages > 8) throw new RangeError(`web_search pages must be an integer from 1 to 8 (got ${String(pages)})`);
    this.pages = pages;
    this.now = options.now ?? (() => new Date());
  }

  /** La pregunta que ve el juez: con la fecha de hoy, para que distinga lo reciente. */
  private judgeNeed(need: string, today: string): string {
    return `${need}\nTODAY: ${today}`;
  }

  /** Ejecuta una consulta al juez con límite de tiempo propio y limpieza explícita del timer. */
  private async withJudgeTimeout<T>(remaining: () => number, signal: AbortSignal | undefined, call: (judgeSignal: AbortSignal) => Promise<T>): Promise<T> {
    const ms = Math.min(Math.max(remaining() - 2000, 1000), this.judgeTimeoutMs);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), ms);
    const merged = signal === undefined ? ctrl.signal : AbortSignal.any([ctrl.signal, signal]);
    try {
      return await call(merged);
    } finally {
      clearTimeout(timer);
    }
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
    const limitMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // El plazo efectivo deja un margen para devolver un fallo claro antes de que el anfitrión corte la herramienta.
    const deadline = started + limitMs - SAFETY_MARGIN_MS;
    const remaining = (): number => deadline - Date.now();
    const timings: Record<string, number> = {};
    const host = options.host;
    const signal = options.signal;
    const limits: Deadline = { signal, deadline, limitMs: limitMs - SAFETY_MARGIN_MS };

    const hasFilters = parsed.args.freshness !== undefined || parsed.args.domains.length > 0;
    let retried = false;
    let relaxed = false;
    let retryFailed: string | undefined;
    let gathered: Gathered;
    let analysis: Analysis;
    try {
      let mark = Date.now();
      ({ gathered, analysis } = await this.attempt(host, query, hasFilters, limits, remaining, signal));
      timings.lookupMs = Date.now() - mark;
      if (gathered.material.docs.length === 0 && gathered.errors.length > 0 && parsed.args.urls.length > 0) {
        return fail(`None of the URLs could be read: ${gathered.errors.join("; ")}`);
      }

      // Sin resultado y con filtros: una sola vez más, sin ellos (si queda tiempo). Es un paso opcional: si falla, se conserva el primer resultado.
      if ((analysis.state === "not_found" || analysis.state === "no_results") && hasFilters && parsed.args.urls.length === 0 && remaining() > RETRY_NEEDS_MS) {
        retried = true;
        try {
          mark = Date.now();
          const { gathered: again, analysis: second } = await this.attempt(host, query, false, limits, remaining, signal);
          timings.retryMs = Date.now() - mark;
          if (second.state === "found" || second.state === "partial" || again.material.docs.length > gathered.material.docs.length) {
            gathered = { ...again, errors: [...gathered.errors, ...again.errors] };
            analysis = second;
            relaxed = true;
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          retryFailed = errorMessage(error);
        }
      }
      // Sin material porque Free Search falló (no porque no haya resultados): es un fallo de la herramienta, no "no hay datos".
      if (analysis.state === "no_results" && gathered.unavailable !== undefined) return fail(`The search service failed: ${gathered.unavailable}`, { reason: "unavailable" });
    } catch (error) {
      if (signal?.aborted) return toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled" } });
      if (error instanceof DeadlineError) return fail(`Web search failed: ${error.message}`, { reason: "timeout", tool: error.tool });
      if (error instanceof ToolBudgetError) return fail(`Web search failed: ${error.message}`, { reason: "tool_budget", tool: error.tool });
      if (error instanceof FormatError) {
        // Ruptura del contrato con Free Search: se dice con la ruta del problema, y lo recibido queda en `raw` para inspeccionarlo (nunca se interpreta).
        return fail(`status: no_results · motivo: formato no reconocido (${error.detail})`, { state: "no_results", reason: "formato no reconocido", detail: error.detail, tool: error.tool }, error.text);
      }
      return fail(`Web search failed: ${errorMessage(error)}`);
    }

    return this.compose(parsed.args, query.need, gathered, analysis, { retried, relaxed, retryFailed, timings, durationMs: Date.now() - started });
  }

  /** Una llamada a Free Search con plazo y cancelación; un «Tool budget used up» del host (que llega como si fuera un resultado) es un error propio. */
  private async callFree(host: NonNullable<ToolCallOptions["host"]>, tool: "search" | "fetch" | "read_doc", args: Record<string, unknown>, limits: Deadline): Promise<{ result: MCPCallResult; text: string }> {
    const result = await callWithDeadline(host, { server: "free_search", tool }, args, limits);
    const text = textOf(result);
    const budget = toolBudgetMessage(text);
    if (budget !== undefined) throw new ToolBudgetError(`free_search/${tool}`, budget);
    return { result, text };
  }

  // ───────────────────────── Obtener el material ─────────────────────────

  /** Una pasada: con `urls`, las lee; si no, busca y decide qué leer. Devuelve el material y el análisis. */
  private async attempt(host: Host, args: WebArgs, withFilters: boolean, limits: Deadline, remaining: () => number, signal?: AbortSignal): Promise<{ gathered: Gathered; analysis: Analysis }> {
    if (args.urls.length > 0) {
      const gathered = await this.gatherUrls(host, args, limits);
      return { gathered, analysis: await this.analyze(args, gathered.material, remaining, signal) };
    }
    return this.lookup(host, args, withFilters, limits, remaining, signal);
  }

  private async gatherUrls(host: Host, args: WebArgs, limits: Deadline): Promise<Gathered> {
    const errors: string[] = [];
    // Las URL se leen a la vez (son independientes); el número de cada fuente es su posición en la lista, y el orden del resultado no depende de cuál responde antes.
    const unique = [...new Set(args.urls)];
    const pages = await Promise.all(unique.map((url, i) => this.readPage(host, url, i + 1, limits)));
    const sources: Source[] = [];
    const docs: Doc[] = [];
    const raws: string[] = [];
    let blocked = 0;
    for (const r of pages) {
      if (r.error !== undefined) errors.push(r.error);
      if (r.blocked === true) blocked++;
      if (r.page === undefined) continue;
      sources.push(r.page.source);
      docs.push(r.page.doc);
      raws.push(r.text ?? "");
    }
    return { material: { sources, docs, blocked, diagnostics: {} }, raw: raws.join("\n\n---\n\n"), errors };
  }

  /** Una página con `fetch`. El error de una página es solo de esa página; plazo vencido, presupuesto agotado, formato desconocido y cancelación afectan a toda la búsqueda. */
  private async readPage(host: Host, url: string, n: number, limits: Deadline): Promise<PageRead> {
    try {
      // La misma antigüedad máxima de la caché que la búsqueda (sin ella, `fetch` usa la de Free Search: 7 días).
      const { result, text } = await this.callFree(host, "fetch", { url, max_age_hours: this.maxAgeHours, format: "json" }, limits);
      if (result.isError === true) return { error: `${url}: ${clipAtWord(text || "error", 120)}` };
      const page = parseFetch(text, url, n);
      if (!page.ok) throw new FormatError("free_search/fetch", `${url}: ${page.detail}`, text);
      if (page.value === null) return { error: `${url}: empty page` };
      if ("blocked" in page.value) return { blocked: true, error: `${url}: blocked by an anti-bot challenge` };
      return { page: page.value, text };
    } catch (error) {
      if (limits.signal?.aborted || error instanceof DeadlineError || error instanceof ToolBudgetError || error instanceof FormatError) throw error;
      return { error: `${url}: ${errorMessage(error)}` };
    }
  }

  /** Lee las páginas de estas fuentes a la vez (sin juez no hay cómo decidir cuál leer). Las URL internas no se leen. */
  private async readMany(host: Host, hits: readonly Source[], limits: Deadline): Promise<{ docs: Doc[]; blocked: number; errors: string[]; raws: string[] }> {
    const readable = hits.filter((h) => !internalUrl(h.url)).slice(0, this.pages);
    const reads = await Promise.all(readable.map((h) => this.readPage(host, h.url, h.n, limits)));
    return {
      docs: reads.flatMap((r) => (r.page === undefined ? [] : [r.page.doc])),
      blocked: reads.filter((r) => r.blocked === true).length,
      errors: reads.flatMap((r) => (r.error !== undefined && r.blocked !== true ? [r.error] : [])),
      raws: reads.flatMap((r) => (r.text === undefined ? [] : [r.text])),
    };
  }

  /** El texto completo de una página larga, por tramos de `read_doc` a la vez. `undefined` si no se pudo leer el primero; un tramo que falla se cuenta en `missing`. */
  private async readWhole(host: Host, url: string, limits: Deadline): Promise<{ text: string; windows: number; totalChars: number; missing: number; complete: boolean } | undefined> {
    const tramo = async (start: number) => {
      const { result, text } = await this.callFree(host, "read_doc", { source: url, start, length: FULL_READ_WINDOW, format: "json" }, limits);
      if (result.isError === true) throw new Error(clipAtWord(text || "read_doc failed", 160));
      const parsed = parseReadDoc(text);
      if (!parsed.ok) throw new FormatError("free_search/read_doc", parsed.detail, text);
      return parsed.value;
    };
    const first = await tramo(0);
    const windows = Math.min(Math.ceil(first.totalChars / FULL_READ_WINDOW), FULL_READ_MAX_WINDOWS);
    const rest = await Promise.all(
      Array.from({ length: Math.max(windows - 1, 0) }, (_, i) =>
        tramo((i + 1) * FULL_READ_WINDOW).then(
          (w) => w.content,
          (error: unknown) => {
            if (limits.signal?.aborted || error instanceof DeadlineError || error instanceof ToolBudgetError) throw error;
            return undefined;
          },
        ),
      ),
    );
    return { text: [first.content, ...rest.map((r) => r ?? "")].join(""), windows, totalChars: first.totalChars, missing: rest.filter((r) => r === undefined).length, complete: first.totalChars <= FULL_READ_MAX_WINDOWS * FULL_READ_WINDOW };
  }

  /**
   * Busca con `search` y decide qué leer. Con juez: puntúa los extractos (con la fecha de cada fuente y la de hoy); si alguno responde, se devuelve sin leer nada; si no,
   * lee UNA página (la del mejor extracto), la puntúa y se detiene en cuanto una responde, hasta `pages` páginas. Sin juez (o sin tiempo para él): lee las primeras
   * páginas a la vez y ordena por palabras. Evaluación: scripts/validate/web_eval/RESULTADOS.md (Ronda 3).
   */
  private async lookup(host: Host, args: WebArgs, withFilters: boolean, limits: Deadline, remaining: () => number, signal?: AbortSignal): Promise<{ gathered: Gathered; analysis: Analysis }> {
    const errors: string[] = [];
    const request: Record<string, unknown> = { query: args.need, max_results: SEARCH_RESULTS, max_age_hours: this.maxAgeHours, format: "json" };
    if (withFilters && args.freshness !== undefined) request.freshness = args.freshness;
    if (withFilters && args.domains.length > 0) request.include_domains = args.domains;
    const { result, text } = await this.callFree(host, "search", request, limits);
    if (result.isError === true) {
      // Free Search informa "sin resultados" como error de herramienta; el resto de sus errores (caída, bloqueo, plazo) es no haber podido buscar.
      const message = clipAtWord(text || "search failed", 200);
      errors.push(message);
      const gathered: Gathered = { material: EMPTY, raw: text, errors, ...(NO_RESULTS.test(text) ? {} : { unavailable: message }) };
      return { gathered, analysis: NO_RESULTS_ANALYSIS };
    }
    const parsed = parseSearch(text);
    if (!parsed.ok) throw new FormatError("free_search/search", parsed.detail, text);
    const hits = parsed.value.sources;
    const diagnostics = parsed.value.diagnostics;
    const finish = (docs: Doc[], blocked: number, raws: string[], analysis: Analysis, more: string[] = []): { gathered: Gathered; analysis: Analysis } => ({
      gathered: { material: { sources: hits, docs, blocked, diagnostics }, raw: [text, ...raws].join("\n\n---\n\n"), errors: [...errors, ...more] },
      analysis,
    });
    if (hits.length === 0) return finish([], 0, [], NO_RESULTS_ANALYSIS);

    const judge = this.getJudge();
    const lexical = async (judgeState: "off" | "failed", meta: Record<string, unknown>, already: { docs: Doc[]; blocked: number; errors: string[]; raws: string[] } | undefined): Promise<{ gathered: Gathered; analysis: Analysis }> => {
      const read = already ?? (await this.readMany(host, hits, limits));
      const material: Material = { sources: hits, docs: read.docs, blocked: read.blocked, diagnostics };
      const analysis = await this.analyze(args, material, remaining, signal, false);
      return finish(read.docs, read.blocked, read.raws, { ...analysis, judge: judgeState, judgeMeta: { ...analysis.judgeMeta, ...meta } }, read.errors);
    };
    if (judge === undefined || remaining() <= JUDGE_NEEDS_MS) return lexical("off", {}, undefined);

    // Estado del recorrido (para devolver lo leído si el juez falla a medias).
    const docs: Doc[] = [];
    const raws: string[] = [];
    const pageErrors: string[] = [];
    let blocked = 0;
    const pool: Scored[] = [];
    const trace: { calls: number; ms: number; snippetProbabilities: number[]; pagesRead: number; raw?: { input: string; output: string }; fullRead?: Record<string, unknown>; fullReadError?: string } = { calls: 0, ms: 0, snippetProbabilities: [], pagesRead: 0 };
    const today = localDate(this.now());
    const need = this.judgeNeed(args.need, today);
    const versions = versionsOf(args.need);
    const sourceOf = new Map(hits.map((h) => [h.n, h]));
    const score = async (texts: string[]): Promise<number[]> => {
      const r = await this.withJudgeTimeout(remaining, signal, (judgeSignal) => judge.score(need, texts, judgeSignal));
      if (r.probabilities.length !== texts.length) throw new Error("el modelo no devolvió una probabilidad por fragmento");
      trace.calls += Math.ceil(texts.length / 5);
      trace.ms += r.durationMs;
      trace.raw = { input: r.rawInput.slice(0, TRACE_RAW_MAX), output: r.rawOutput.slice(0, TRACE_RAW_MAX) };
      return [...r.probabilities];
    };
    const done = (state: State, chosen: readonly Scored[], candidates: number): { gathered: Gathered; analysis: Analysis } =>
      finish(docs, blocked, raws, {
        state,
        passages: chosen.slice(0, RETURN_MAX).map((c) => ({ n: c.n, text: c.text, score: c.score, probability: c.p, ...(c.snippet ? { snippet: true } : {}) })),
        candidates,
        judge: "used",
        judgeMeta: { durationMs: trace.ms, calls: trace.calls, snippetProbabilities: trace.snippetProbabilities.map((p) => Number(p.toFixed(3))), pagesRead: trace.pagesRead, today, ...(versions.length > 0 ? { versionGuard: versions } : {}), ...(trace.fullRead === undefined ? {} : { fullRead: trace.fullRead }), ...(trace.fullReadError === undefined ? {} : { fullReadError: trace.fullReadError }), ...(trace.raw === undefined ? {} : { rawInput: trace.raw.input, rawOutput: trace.raw.output }) },
      }, pageErrors);

    try {
      // Etapa 1: ¿algún extracto ya responde?
      const snippets: Scored[] = snippetChunks(hits, 0).map((c) => ({ n: c.n, text: c.text, snippet: true, score: 0, p: 0 }));
      if (snippets.length > 0) {
        const p = await score(snippets.map((c) => dated(sourceOf.get(c.n), c.text)));
        snippets.forEach((c, i) => { c.p = guardVersions(versions, c.text, p[i]); });
        trace.snippetProbabilities = snippets.map((c) => c.p);
        pool.push(...snippets);
      }
      const byP = (a: Scored, b: Scored): number => b.p - a.p || a.n - b.n;
      const strong = snippets.filter((c) => c.p >= JUDGE_FOUND).sort(byP);
      if (strong.length > 0) return done("found", strong.slice(0, SNIPPET_RETURN_MAX), snippets.length);

      // Etapa 2: de a una página, la del mejor extracto primero (las fuentes sin extracto, al final por su posición).
      const bestP = new Map(snippets.map((c) => [c.n, c.p]));
      const order = hits.filter((h) => !internalUrl(h.url)).sort((a, b) => (bestP.get(b.n) ?? -1) - (bestP.get(a.n) ?? -1) || a.n - b.n);
      let attempts = 0;
      for (const hit of order) {
        if (attempts >= this.pages || remaining() <= JUDGE_NEEDS_MS) break;
        attempts++;
        const read = await this.readPage(host, hit.url, hit.n, limits);
        if (read.error !== undefined && read.blocked !== true) pageErrors.push(read.error);
        if (read.blocked === true) blocked++;
        if (read.page === undefined) continue;
        docs.push(read.page.doc);
        raws.push(read.text ?? "");
        trace.pagesRead++;
        const cands = pickCandidates(rank(chunkDocs([read.page.doc]), args.need).ranked, PAGE_CANDIDATES, PAGE_CANDIDATES);
        if (cands.length === 0) continue;
        const p = await score(cands.map((c) => dated(hit, c.chunk.text)));
        const scored: Scored[] = cands.map((c, i) => ({ n: hit.n, text: c.chunk.text, score: c.score, p: guardVersions(versions, c.chunk.text, p[i]) })).sort(byP);
        pool.push(...scored);
        if (scored[0].p >= JUDGE_FOUND) return done("found", scored.filter((c) => c.p >= JUDGE_PARTIAL).slice(0, PAGE_RETURN_MAX), pool.length);
      }
      // Último recurso: una página cortada por Free Search puede tener la respuesta en lo que no se leyó. Es un paso opcional: si falla, se conserva lo que había.
      const cut = docs.find((d) => d.truncated === true);
      if (cut !== undefined && remaining() > FULL_READ_NEEDS_MS) {
        try {
          const whole = await this.readWhole(host, cut.url, limits);
          if (whole !== undefined) {
            trace.fullRead = { url: cut.url, windows: whole.windows, chars: whole.text.length, totalChars: whole.totalChars, missing: whole.missing, complete: whole.complete && whole.missing === 0 };
            const cands = pickCandidates(rank(chunkDocs([{ ...cut, body: whole.text }]), args.need).ranked, FULL_PAGE_CANDIDATES, FULL_PAGE_CANDIDATES);
            if (cands.length > 0) {
              const p = await score(cands.map((c) => dated(sourceOf.get(cut.n), c.chunk.text)));
              const scored: Scored[] = cands.map((c, i) => ({ n: cut.n, text: c.chunk.text, score: c.score, p: guardVersions(versions, c.chunk.text, p[i]) })).sort(byP);
              pool.push(...scored);
              if (scored[0].p >= JUDGE_FOUND) return done("found", scored.filter((c) => c.p >= JUDGE_PARTIAL).slice(0, PAGE_RETURN_MAX), pool.length);
            }
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          trace.fullReadError = errorMessage(error);
        }
      }
      // Ninguno llegó al umbral alto: lo mejor por encima del parcial (extractos y páginas), o nada.
      const ranked = [...pool].sort(byP);
      const best = ranked[0]?.p ?? 0;
      const state: State = best >= JUDGE_PARTIAL ? "partial" : "not_found";
      return done(state, state === "partial" ? ranked.filter((c) => c.p >= JUDGE_PARTIAL).slice(0, PAGE_RETURN_MAX) : [], pool.length);
    } catch (error) {
      if (signal?.aborted) throw error; // cancelación de la tarea (no el plazo del modelo)
      // El modelo falló (caído, malformado, plazo): se sigue con el orden léxico sobre lo leído (y se leen las primeras páginas si aún no se leyó ninguna).
      const already = docs.length > 0 ? { docs, blocked, errors: pageErrors, raws } : undefined;
      return lexical("failed", { error: errorMessage(error) }, already);
    }
  }

  // ───────────────────────── Analizar ─────────────────────────

  private async analyze(args: WebArgs, material: Material, remaining: () => number, signal?: AbortSignal, useJudge = true): Promise<Analysis> {
    // Sin páginas pero con extractos (Free Search no pudo leer ninguna), los extractos solos todavía pueden responder.
    const pages = chunkDocs(material.docs);
    const chunks = [...pages, ...snippetChunks(material.sources, pages.length)];
    if (material.docs.length === 0 && chunks.length === 0) return { state: "no_results", passages: [], candidates: 0, judge: "off", judgeMeta: {} };
    const { ranked } = rank(chunks, args.need);
    // Con una sola página (p. ej. una URL dada) el tope por fuente no tiene sentido: los candidatos salen de ella.
    const candidates = pickCandidates(ranked, CANDIDATES, material.docs.length <= 1 ? CANDIDATES : PER_SOURCE);
    if (candidates.length === 0) return { state: "not_found", passages: [], candidates: 0, judge: "off", judgeMeta: { chunks: chunks.length } };

    const judge = useJudge ? this.getJudge() : undefined;
    if (judge !== undefined && remaining() > JUDGE_NEEDS_MS) {
      const sourceOf = new Map(material.sources.map((x) => [x.n, x]));
      try {
        const scores = await this.withJudgeTimeout(remaining, signal, (judgeSignal) =>
          judge.score(this.judgeNeed(args.need, localDate(this.now())), candidates.map((c) => dated(sourceOf.get(c.chunk.n), c.chunk.text)), judgeSignal),
        );
        if (scores.probabilities.length === candidates.length) {
          const versions = versionsOf(args.need);
          const scored = candidates
            .map((c, i) => ({ c, p: guardVersions(versions, c.chunk.text, scores.probabilities[i]) }))
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

  private compose(args: WebArgs, question: string, gathered: Gathered, analysis: Analysis, info: { retried: boolean; relaxed: boolean; retryFailed?: string; timings: Record<string, number>; durationMs: number }): MCPCallResult {
    const sourceOf = new Map(gathered.material.sources.map((s) => [s.n, s]));
    const sourceLine = (n: number): string => {
      const s = sourceOf.get(n);
      return s === undefined ? `[${n}]` : `[${n}] ${clipAtWord(s.title, 90)} — ${s.url}${s.date === undefined ? "" : ` (${dateLabel(s)})`}`;
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
    const read = gathered.material.docs.length;
    const blocked = gathered.material.blocked;
    // Free Search corta las páginas muy largas (~50 000 caracteres): lo que queda más allá no se leyó, y la respuesta puede estar ahí.
    const full = analysis.judgeMeta.fullRead as { url?: string; complete?: boolean } | undefined;
    const cutShort = gathered.material.docs.filter((d) => d.truncated === true && !(full?.complete === true && full.url === d.url)).length;
    // Hasta dónde se llegó: solo los extractos del buscador, páginas leídas, las URL dadas, o nada.
    const stage = args.urls.length > 0 ? "urls" : analysis.state === "no_results" ? "none" : read > 0 ? "pages" : "snippets";

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
        lines.push(
          `status: not_found · no passage answers the question (${read} page${read === 1 ? "" : "s"} read${blocked > 0 ? `, ${blocked} blocked by an anti-bot challenge` : ""})`,
        );
        break;
      case "no_results":
        lines.push(blocked > 0 ? `status: no_results · ${blocked} page${blocked === 1 ? "" : "s"} found but blocked by an anti-bot challenge` : "status: no_results · nothing was found for this search");
        if (gathered.errors.length > 0) lines.push(`(${gathered.errors[0]})`);
        break;
    }
    // El reintento sin filtros cambió lo que se pidió: el modelo tiene que saberlo (un sitio o una fecha que pidió el usuario pueden no cumplirse).
    if (info.relaxed) lines.splice(1, 0, `note: nothing matched the requested ${[args.freshness !== undefined ? "freshness" : "", args.domains.length > 0 ? "domains" : ""].filter(Boolean).join(" and ")}; this comes from a search without ${args.freshness !== undefined && args.domains.length > 0 ? "those filters" : "that filter"}.`);
    // Sin una respuesta firme y con páginas cortadas: el modelo tiene que saber que quedó contenido sin leer (y que puede probar con otra página).
    if (analysis.state !== "found" && cutShort > 0) {
      lines.push(`note: ${cutShort === 1 ? "1 page was" : `${cutShort} pages were`} cut short at the size limit, so the answer may be in the part that was not read; try web_search with the 'urls' of a more specific page.`);
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
        sources: gathered.material.sources.map((s) => ({ n: s.n, title: s.title, url: s.url, ...(s.date === undefined ? {} : { date: s.date, dateSource: s.dateSource }) })),
        candidates: analysis.candidates,
        judge: analysis.judge,
        stage,
        retried: info.retried,
        relaxed: info.relaxed,
        read,
        blocked,
        cutShort,
        fullRead: full !== undefined,
      },
      meta: {
        need: args.need,
        ...(question === args.need ? {} : { question }),
        filters: { freshness: args.freshness ?? null, domains: args.domains, relaxed: info.relaxed },
        ...(info.retryFailed === undefined ? {} : { retryFailed: info.retryFailed }),
        maxAgeHours: this.maxAgeHours,
        pages: this.pages,
        freeSearch: gathered.material.diagnostics,
        durationMs: info.durationMs,
        timings: info.timings,
        judge: { mode: analysis.judge, ...analysis.judgeMeta },
        errors: gathered.errors,
        budget: BUDGET.summaryMax,
      },
    });
  }
}
