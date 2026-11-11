/**
 * `web_search`: lectura de lo que devuelve Free Search.
 *
 * - `research`: el "Research brief": `## Sources` (una línea `- [n] **título** — <url>` por fuente, con `_published AAAA-MM-DD` y un extracto `> …` debajo) y
 *   `## Documents` (por cada página, una línea `<url> · ~N tokens` y su texto completo).
 * - `fetch`: `# título`, `<url>`, líneas de procedencia y, tras `_fetched via …_`, el Markdown de la página.
 * Un resultado que no tiene esa forma se trata como una sola página de texto (nunca se descarta contenido por no reconocer el formato).
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
}

const SOURCE_HEAD = /^- \[(\d+)\]\s+\*\*(.+?)\*\*\s+—\s+<([^>]+)>/;
const DOC_HEAD = /^<(https?:\/\/[^>]+)>\s+·\s+~\d+\s+tokens\s*$/;

export function parseResearch(text: string): Material {
  const sourcesAt = text.indexOf("## Sources");
  if (!text.startsWith("# Research brief") || sourcesAt < 0) return text.trim() === "" ? { sources: [], docs: [] } : { sources: [], docs: [{ n: 1, url: "", body: text }] };

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
    const date = /_published\s+(\d{4}-\d{2}-\d{2})/.exec(line)?.[1];
    if (date !== undefined && open.date === undefined) open.date = date;
    const snippet = /^\s+>\s*(.+)$/.exec(line)?.[1];
    if (snippet !== undefined && open.snippet === undefined) open.snippet = snippet.trim();
  }

  const byUrl = new Map(sources.map((s) => [s.url, s.n]));
  const docs: Doc[] = [];
  let current: { url: string; lines: string[] } | undefined;
  const close = (): void => {
    if (current) docs.push({ n: byUrl.get(current.url) ?? sources.length + docs.length + 1, url: current.url, body: current.lines.join("\n") });
    current = undefined;
  };
  if (docsAt >= 0) {
    for (const line of text.slice(docsAt).split("\n")) {
      const head = DOC_HEAD.exec(line);
      if (head) {
        close();
        current = { url: head[1], lines: [] };
      } else if (current) {
        current.lines.push(line);
      }
    }
    close();
  }
  return { sources, docs };
}

/** Una página de `fetch`: su título (si lo trae) y el Markdown posterior a las líneas de procedencia. */
export function parseFetch(text: string, url: string, n: number): { source: Source; doc: Doc } | null {
  if (text.trim() === "") return null;
  const lines = text.split("\n");
  const title = /^#\s+(.+)$/.exec(lines[0] ?? "")?.[1]?.trim() ?? url;
  const fetched = lines.findIndex((line) => line.startsWith("_fetched via"));
  const body = (fetched >= 0 ? lines.slice(fetched + 1) : lines).join("\n").trim();
  const date = /published\s+(\d{4}-\d{2}-\d{2})/.exec(lines.slice(0, fetched >= 0 ? fetched : 4).join("\n"))?.[1];
  return body === "" ? null : { source: { n, title, url, ...(date === undefined ? {} : { date }) }, doc: { n, url, body } };
}
