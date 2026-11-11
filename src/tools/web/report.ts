/**
 * `web_search`: lectura de lo que devuelve Free Search.
 *
 * - `research`: el "Research brief": `## Sources` (una línea `- [n] **título** — <url>` por fuente, con `_published AAAA-MM-DD` y un extracto `> …` debajo) y
 *   `## Documents` (por cada página, una línea `### título`, otra `<url> · ~N tokens` y su texto completo; muestra real en `scripts/validate/samples/`).
 * - `fetch`: `# título`, `<url>`, líneas de procedencia y, tras `_fetched via …_`, el Markdown de la página.
 * Un resultado que no tiene esa forma se trata como una sola página de texto (nunca se descarta contenido por no reconocer el formato), pero queda marcado
 * (`format: "unrecognized"`) para que el resultado lo avise: sin eso, un cambio de formato de Free Search degradaría la tool en silencio.
 *
 * Las fechas de publicación imposibles (futuras o anteriores a la web) se descartan: es mejor no dar fecha que dar una mal inferida.
 */

export interface Source {
  readonly n: number;
  readonly title: string;
  readonly url: string;
  /** Fecha de publicación (`AAAA-MM-DD`) si la fuente la informa: suele ser la respuesta a "¿cuándo salió…?". */
  readonly date?: string;
  /** Extracto que el buscador mostró para la fuente. */
  readonly snippet?: string;
}

export interface Doc {
  /** Número de la fuente (`[n]`) a la que pertenece el texto. */
  readonly n: number;
  readonly url: string;
  readonly body: string;
}

export interface Material {
  readonly sources: readonly Source[];
  readonly docs: readonly Doc[];
  /** `unrecognized`: el texto no tenía la forma esperada y se tomó entero como una página (sin fuentes, títulos ni fechas). */
  readonly format?: "brief" | "unrecognized";
}

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

const SOURCE_HEAD = /^- \[(\d+)\]\s+\*\*(.+?)\*\*\s+—\s+<([^>]+)>/;
const DOC_HEAD = /^<(https?:\/\/[^>]+)>\s+·\s+~\d+\s+tokens\s*$/;
const DOC_TITLE = /^###\s+(\S.*)$/;

export function parseResearch(text: string): Material {
  const sourcesAt = text.indexOf("## Sources");
  if (!text.startsWith("# Research brief") || sourcesAt < 0) {
    return text.trim() === "" ? { sources: [], docs: [] } : { sources: [], docs: [{ n: 1, url: "", body: text }], format: "unrecognized" };
  }

  const docsAt = text.indexOf("\n## Documents");
  const sources: Source[] = [];
  let open: { -readonly [K in keyof Source]: Source[K] } | undefined;
  for (const line of text.slice(sourcesAt, docsAt < 0 ? undefined : docsAt).split("\n")) {
    const head = SOURCE_HEAD.exec(line);
    if (head) {
      open = { n: Number(head[1]), title: head[2].trim(), url: head[3].trim() };
      sources.push(open);
      continue;
    }
    if (open === undefined) continue;
    const date = plausibleDate(/_published\s+(\d{4}-\d{2}-\d{2})/.exec(line)?.[1]);
    if (date !== undefined && open.date === undefined) open.date = date;
    const snippet = /^\s+>\s*(.+)$/.exec(line)?.[1];
    if (snippet !== undefined && open.snippet === undefined) open.snippet = snippet.trim();
  }

  const byUrl = new Map(sources.map((s) => [urlKey(s.url), s.n]));
  let next = sources.reduce((max, s) => Math.max(max, s.n), 0) + 1;
  const docs: Doc[] = [];
  let current: { url: string; title?: string; lines: string[] } | undefined;
  const close = (): void => {
    if (current) {
      const body = current.lines.join("\n").trim();
      let n = byUrl.get(urlKey(current.url));
      if (n === undefined) {
        // Una página sin fuente en la lista recibe un número propio (que no choca con ninguno) y una fuente con su título y URL, para poder citarla.
        n = next++;
        byUrl.set(urlKey(current.url), n);
        sources.push({ n, title: current.title ?? current.url, url: current.url });
      }
      if (body !== "") docs.push({ n, url: current.url, body });
    }
    current = undefined;
  };
  if (docsAt >= 0) {
    const lines = text.slice(docsAt).split("\n");
    lines.forEach((line, i) => {
      // El `### título` de una página va justo antes de su línea `<url> · ~N tokens`: es de la página siguiente, no el final de la anterior.
      if (DOC_TITLE.test(line) && DOC_HEAD.test(lines[i + 1] ?? "")) return;
      const head = DOC_HEAD.exec(line);
      if (head) {
        close();
        const title = DOC_TITLE.exec(lines[i - 1] ?? "")?.[1]?.trim();
        current = { url: head[1], ...(title === undefined ? {} : { title }), lines: [] };
      } else if (current) {
        current.lines.push(line);
      }
    });
    close();
  }
  return { sources, docs, format: "brief" };
}

/** Una página de `fetch`: su título (si lo trae) y el Markdown posterior a las líneas de procedencia. */
export function parseFetch(text: string, url: string, n: number): { source: Source; doc: Doc } | null {
  if (text.trim() === "") return null;
  const lines = text.split("\n");
  const title = /^#\s+(.+)$/.exec(lines[0] ?? "")?.[1]?.trim() ?? url;
  const fetched = lines.findIndex((line) => line.startsWith("_fetched via"));
  const body = (fetched >= 0 ? lines.slice(fetched + 1) : lines).join("\n").trim();
  const date = plausibleDate(/published\s+(\d{4}-\d{2}-\d{2})/.exec(lines.slice(0, fetched >= 0 ? fetched : 4).join("\n"))?.[1]);
  return body === "" ? null : { source: { n, title, url, ...(date === undefined ? {} : { date }) }, doc: { n, url, body } };
}
