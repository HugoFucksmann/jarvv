/**
 * `web_search`: lectura de lo que devuelve Free Search, pedido con `format: "json"` (más datos que el Markdown y un contrato, no una presentación para humanos).
 *
 * - `search`: `{ query, engines, results: [{ title, url, snippet, published_age?, date_source, engines, score, source_type? }], … }` (`parseSearch`).
 * - `fetch`: `{ url, title, content, method, truncated, published_date, … }` (`parseFetch`).
 *
 * Contrato: lo que se lee (y de qué tipo) está en este archivo; una respuesta que no es JSON, o a la que le falta lo que se lee, se RECHAZA con la ruta del
 * problema (`Parsed.ok === false`): nunca se confunde con "sin resultados" ni se toma como una página. Los campos nuevos se ignoran.
 *
 * Fechas: la de cada fuente es `published_age` (`AAAA-MM-DD`) calificada por `date_source` (`structured` = la dio la página, `snippet` = se leyó del extracto); `none` es
 * "sin fecha". Una fecha imposible (futura, anterior a la web) se descarta: es mejor no dar fecha que dar una mal inferida. De `fetch` se usa `published_date`.
 *
 * Los desafíos anti-bot (Free Search los devuelve como si fueran páginas, sin marcarlos) se detectan por heurística acotada y no cuentan como páginas leídas.
 */

export interface Source {
  readonly n: number;
  readonly title: string;
  readonly url: string;
  /** Fecha de publicación (`AAAA-MM-DD`) si la fuente la informa: suele ser la respuesta a "¿cuándo salió…?". */
  readonly date?: string;
  /** De dónde salió la fecha: `structured` (la página) o `snippet` (el extracto del buscador, menos fiable). */
  readonly dateSource?: "structured" | "snippet";
  /** Extracto que el buscador mostró para la fuente (sin el prefijo de fecha del buscador). */
  readonly snippet?: string;
}

export interface Doc {
  /** Número de la fuente (`[n]`) a la que pertenece el texto. */
  readonly n: number;
  readonly url: string;
  readonly body: string;
  /** `fetch` informó que Free Search cortó la página. */
  readonly truncated?: boolean;
}

export interface Material {
  readonly sources: readonly Source[];
  readonly docs: readonly Doc[];
  /** Páginas que Free Search devolvió pero eran un desafío anti-bot: no se leyeron. */
  readonly blocked: number;
  /** Datos de Free Search útiles para diagnosticar (no se muestran al modelo). */
  readonly diagnostics: Record<string, unknown>;
}

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const bad = (detail: string): { ok: false; detail: string } => ({ ok: false, detail });

/** La primera página web es de 1991: una fecha anterior, o posterior a mañana, es un dato mal inferido por el buscador. */
const FIRST_WEB_DATE = "1991-08-06";

/** La fecha `AAAA-MM-DD` si es posible como fecha de publicación; si no, `undefined`. */
export function plausibleDate(date: string | undefined, now = new Date()): string | undefined {
  if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return undefined; // 2024-02-31 y similares
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  return date >= FIRST_WEB_DATE && date <= tomorrow ? date : undefined;
}

/** El buscador antepone la fecha al extracto (`2024/5/7 -Node.js 22 …`): se quita para que sus números no cuenten como términos. Solo la forma verificada. */
export function cleanSnippet(snippet: string): string {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s*-\s*/.exec(snippet);
  if (m === null || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return snippet.trim();
  return snippet.slice(m[0].length).trim();
}

/** Un desafío anti-bot (no el contenido): cuerpo corto con la frase propia de un desafío. Heurística: el JSON no trae ningún indicador de bloqueo. */
const BLOCK_PHRASE = /prove your humanity|client challenge|just a moment|verify you are (?:a )?human|enable javascript and cookies|checking your browser|access denied|attention required|are you a robot|unusual traffic/i;
const BLOCK_MAX_CHARS = 600;
export function isBlockPage(body: string): boolean {
  return body.length <= BLOCK_MAX_CHARS && BLOCK_PHRASE.test(body);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseJson(text: string): Parsed<Record<string, unknown>> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return bad(`not JSON (starts with ${JSON.stringify(text.trim().slice(0, 40))})`);
  }
  return isRecord(data) ? { ok: true, value: data } : bad("JSON is not an object");
}

const DIAGNOSTIC_KEYS = [
  "engines", "tokens_estimated", "errors", "retrieved_at", "search_cache_age_seconds", "date_note",
  "gated_engines", "gated_hint", "benched_engines", "benched_hint", "rescued_via",
];

/** Una página de `fetch`: su título (si lo trae) y su contenido. `null` si no tiene texto o es un desafío anti-bot (`blocked`). */
export function parseFetch(text: string, url: string, n: number): Parsed<{ source: Source; doc: Doc } | { blocked: true } | null> {
  if (text.trim() === "") return { ok: true, value: null };
  const json = parseJson(text);
  if (!json.ok) return json;
  const raw = json.value;
  if (typeof raw.content !== "string") return bad("content: missing or not a text");
  const body = raw.content.trim();
  if (body === "") return { ok: true, value: null };
  if (isBlockPage(body)) return { ok: true, value: { blocked: true } };
  const title = typeof raw.title === "string" && raw.title.trim() !== "" ? raw.title.trim() : url;
  const date = typeof raw.published_date === "string" ? plausibleDate(raw.published_date.slice(0, 10)) : undefined;
  return {
    ok: true,
    value: {
      source: { n, title, url, ...(date === undefined ? {} : { date, dateSource: "structured" as const }) },
      doc: { n, url, body, ...(raw.truncated === true ? { truncated: true } : {}) },
    },
  };
}

/**
 * `search`: `{ query, engines, results: [{ title, url, snippet, published_age?, date_source, engines, score, source_type? }], errors?, … }`. Cada resultado es una fuente, numerada por
 * su posición (`n` = 1, 2, …); no trae el texto de las páginas (eso es `fetch`).
 */
export function parseSearch(text: string): Parsed<{ sources: Source[]; diagnostics: Record<string, unknown> }> {
  if (text.trim() === "") return bad("empty answer");
  const json = parseJson(text);
  if (!json.ok) return json;
  const raw = json.value;
  if (!Array.isArray(raw.results)) return bad("results: missing or not a list");
  const sources: Source[] = [];
  for (const [i, r] of raw.results.entries()) {
    const at = `results[${i}]`;
    if (!isRecord(r)) return bad(`${at}: not an object`);
    if (typeof r.url !== "string" || r.url === "") return bad(`${at}.url: missing or not a text`);
    if (typeof r.title !== "string") return bad(`${at}.title: missing or not a text`);
    if (r.snippet !== undefined && r.snippet !== null && typeof r.snippet !== "string") return bad(`${at}.snippet: not a text`);
    const dateSource = r.date_source === "structured" || r.date_source === "snippet" ? r.date_source : undefined;
    const date = dateSource === undefined || typeof r.published_age !== "string" ? undefined : plausibleDate(r.published_age);
    const snippet = typeof r.snippet === "string" ? cleanSnippet(r.snippet) : "";
    sources.push({
      n: i + 1,
      title: r.title.trim(),
      url: r.url.trim(),
      ...(date === undefined ? {} : { date, dateSource: dateSource as "structured" | "snippet" }),
      ...(snippet === "" ? {} : { snippet }),
    });
  }
  const diagnostics = Object.fromEntries(
    [...DIAGNOSTIC_KEYS, "auto_routed", "timed_out_engines", "filter_diagnostics", "freshness_note", "dated_results", "hint"].filter((k) => raw[k] !== undefined && raw[k] !== null).map((k) => [k, raw[k]]),
  );
  return { ok: true, value: { sources, diagnostics } };
}

/**
 * `read_doc`: `{ source, format, title, content, truncated, pages, tokens_estimated, total_chars, start, returned_chars }`. Entrega un documento o una página larga por tramos
 * (`start`, `length`; unos 50 000 caracteres por llamada): `total_chars` es el largo completo.
 */
export function parseReadDoc(text: string): Parsed<{ content: string; totalChars: number; start: number }> {
  if (text.trim() === "") return bad("empty answer");
  const json = parseJson(text);
  if (!json.ok) return json;
  const raw = json.value;
  if (typeof raw.content !== "string") return bad("content: missing or not a text");
  if (typeof raw.total_chars !== "number" || !Number.isInteger(raw.total_chars) || raw.total_chars < 0) return bad("total_chars: missing or not a non-negative integer");
  if (typeof raw.start !== "number" || !Number.isInteger(raw.start) || raw.start < 0) return bad("start: missing or not a non-negative integer");
  return { ok: true, value: { content: raw.content, totalChars: raw.total_chars, start: raw.start } };
}
