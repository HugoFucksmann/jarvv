/**
 * SOLO PARA LA EVALUACIÓN: lee las capturas de `research` (captures/*.json, rondas 1 y 2). La tool ya no usa `research` (usa `search` + `fetch`), así que este lector
 * no vive en `src/`; se conserva para poder reproducir esas rondas con las mismas capturas.
 */
import { cleanSnippet, isBlockPage, plausibleDate, type Doc, type Material, type Parsed, type Source } from "../../../src/tools/web/report.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (detail: string): { ok: false; detail: string } => ({ ok: false, detail });
const parseJson = (text: string): Parsed<Record<string, unknown>> => {
  try {
    const data: unknown = JSON.parse(text);
    return isRecord(data) ? { ok: true, value: data } : bad("JSON is not an object");
  } catch {
    return bad("not JSON");
  }
};

/** Clave para emparejar la URL de una página con la de su fuente: sin esquema, `www.`, fragmento ni barra final, y el host en minúsculas. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${u.port === "" ? "" : `:${u.port}`}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

export function parseResearch(text: string): Parsed<Material> {
  if (text.trim() === "") return bad("empty answer");
  const json = parseJson(text);
  if (!json.ok) return json;
  const raw = json.value;
  if (!Array.isArray(raw.sources)) return bad("sources: missing or not a list");
  if (!Array.isArray(raw.documents)) return bad("documents: missing or not a list");

  const sources: Source[] = [];
  const seen = new Set<number>();
  for (const [i, s] of raw.sources.entries()) {
    const at = `sources[${i}]`;
    if (!isRecord(s)) return bad(`${at}: not an object`);
    if (typeof s.rank !== "number" || !Number.isInteger(s.rank) || s.rank < 1) return bad(`${at}.rank: missing or not a positive integer`);
    if (seen.has(s.rank)) return bad(`${at}.rank: repeated (${s.rank})`);
    if (typeof s.title !== "string") return bad(`${at}.title: missing or not a text`);
    if (typeof s.url !== "string" || s.url === "") return bad(`${at}.url: missing or not a text`);
    if (s.snippet !== undefined && s.snippet !== null && typeof s.snippet !== "string") return bad(`${at}.snippet: not a text`);
    seen.add(s.rank);
    // `date_source` desconocido o `published_age` con otra forma (p. ej. «3 days ago»): se degrada a "sin fecha" en vez de tirar la lectura.
    const dateSource = s.date_source === "structured" || s.date_source === "snippet" ? s.date_source : undefined;
    const date = dateSource === undefined || typeof s.published_age !== "string" ? undefined : plausibleDate(s.published_age);
    const snippet = typeof s.snippet === "string" ? cleanSnippet(s.snippet) : "";
    sources.push({
      n: s.rank,
      title: s.title.trim(),
      url: s.url.trim(),
      ...(date === undefined ? {} : { date, dateSource: dateSource as "structured" | "snippet" }),
      ...(snippet === "" ? {} : { snippet }),
    });
  }

  const byUrl = new Map(sources.map((s) => [urlKey(s.url), s.n]));
  let next = sources.reduce((max, s) => Math.max(max, s.n), 0) + 1;
  const docs: Doc[] = [];
  let blocked = 0;
  for (const [i, d] of raw.documents.entries()) {
    const at = `documents[${i}]`;
    if (!isRecord(d)) return bad(`${at}: not an object`);
    if (typeof d.url !== "string" || d.url === "") return bad(`${at}.url: missing or not a text`);
    if (typeof d.content !== "string") return bad(`${at}.content: missing or not a text`);
    const body = d.content.trim();
    if (body === "") continue;
    if (isBlockPage(body)) {
      blocked++;
      continue;
    }
    let n = byUrl.get(urlKey(d.url));
    if (n === undefined) {
      // Una página sin fuente en la lista recibe un número propio (que no choca con ninguno) y una fuente con su título y URL, para poder citarla.
      n = next++;
      byUrl.set(urlKey(d.url), n);
      sources.push({ n, title: typeof d.title === "string" && d.title.trim() !== "" ? d.title.trim() : d.url, url: d.url });
    }
    docs.push({ n, url: d.url, body, ...(d.truncated === true ? { truncated: true } : {}) });
  }
  const diagnostics = Object.fromEntries(["engines", "errors", "date_note", "rescued_via"].filter((k) => raw[k] !== undefined && raw[k] !== null).map((k) => [k, raw[k]]));
  return { ok: true, value: { sources, docs, blocked, diagnostics } };
}

