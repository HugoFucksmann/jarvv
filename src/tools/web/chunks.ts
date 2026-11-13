/**
 * `web_search`: limpieza del texto de las páginas y partición en fragmentos.
 *
 * Limpieza (por línea, sin modelos): fuera los enlaces sueltos, los restos de navegación y banners (cortos), las líneas de solo símbolos y las que ya
 * aparecieron en otra fuente; los destinos de los enlaces `[texto](url)` y las imágenes se quitan y queda el texto. Los bloques de código (```) se conservan
 * tal cual, con su sangría, y nada de su interior se toma por título ni por navegación.
 *
 * Partición: las líneas (y las frases de una línea larga) se empaquetan hasta `CHUNK_MAX` caracteres. Un título abre fragmento nuevo si el anterior ya tiene
 * `CHUNK_MIN`; un párrafo que cabría entero en un fragmento nuevo no se parte entre dos. Cada fragmento que no empieza con un título repite el último título
 * de la página (y una tabla partida, su fila de encabezado): sin eso, "## Requisitos" y "| Versión | Fecha |" quedan en otro fragmento y el texto pierde
 * su sentido. Todo el texto de un fragmento es literal de la página (nunca se resume ni se reescribe).
 */

import { fold } from "../../core/text.ts";
import type { Doc, Source } from "./report.ts";

export const CHUNK_MIN = 500;
export const CHUNK_MAX = 800;
/** Un fragmento más corto que esto no dice nada por sí solo. */
const CHUNK_FLOOR = 40;
/** Solo las líneas de este largo o más se comparan entre fuentes para quitar repetidos. */
const DEDUPE_MIN = 40;
/** Las líneas de navegación y banners son cortas: una línea larga con esas palabras es contenido. */
const BOILERPLATE_MAX = 120;
/** Largo máximo del título que se repite al comienzo de cada fragmento de su sección. */
const HEADING_MAX = 100;

const LINKS_ONLY = /^\s*(?:[-*•·|]\s*)*(?:!?\[[^\]]*\]\([^)]*\)\s*(?:[-*•·|]\s*)*)+$/;
const startsWith = (phrases: readonly string[]): RegExp => new RegExp(`^(?:${phrases.join("|")})(?![\\p{L}])`, "iu");
/** Avisos (cookies, derechos, políticas): una línea corta que empieza así es un banner aunque siga con más texto. */
const NOTICE = startsWith([
  "skip to (?:main )?content", "accept(?: all)? cookies?", "we use cookies", "cookie (?:settings|policy|preferences)", "all rights reserved", "privacy policy",
  "terms (?:of use|of service|and conditions)",
  "ir al contenido", "acept(?:ar|o)(?: todas)?(?: las)? cookies?", "usamos cookies", "configuraci[oó]n de cookies", "todos los derechos reservados",
  "pol[ií]tica de (?:privacidad|cookies)", "t[eé]rminos y condiciones",
]);
/**
 * Acciones de navegación (entrar, suscribirse, compartir): solo son navegación como botón, de pocas palabras. "Sign in with the CLI first: az login" o
 * "Log in to the console with your account before…" son instrucciones de una documentación y se conservan.
 */
const ACTION = startsWith([
  "subscribe(?: to our newsletter)?", "sign (?:in|up)", "log ?in", "share (?:on|this)", "follow us", "read more", "related (?:articles|posts)",
  "suscr[ií]bete", "iniciar sesi[oó]n", "reg[ií]strate", "compartir en", "s[ií]guenos", "leer m[aá]s", "art[ií]culos relacionados",
]);
const ACTION_MAX_WORDS = 4;
/** Etiquetas de navegación que, solas en una línea, no son contenido. */
const NAV_LABEL = /^(?:menu|men[uú]|search|buscar|newsletter|bolet[ií]n|back to top|volver arriba|advertisement|publicidad|cookies)[\s:.]*$/i;
/** Títulos que solo pueden ser navegación o publicidad. */
const PURE_NAV_HEADING = /^(?:menu|men[uú]|back to top|volver arriba|advertisement|publicidad)[\s:.]*$/i;
const SYMBOLS_ONLY = /^[\W_]+$/u;
const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^#{1,6}\s/;
/** Fila separadora de una tabla Markdown (`|---|:--:|`): marca que la fila anterior es el encabezado. */
const TABLE_SEPARATOR = /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{0,}:?\s*\|?$/;
/** Etiquetas HTML que se quitan (solo nombres de HTML reales: `Map<string>` o `Vec<T>` en un texto técnico se conservan). */
const HTML_TAG =
  /<\/?(?:a|abbr|b|blockquote|br|button|cite|code|del|div|em|figcaption|figure|font|h[1-6]|hr|i|img|input|ins|kbd|label|li|mark|ol|p|pre|s|small|span|strike|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul)\b[^>]*>/gi;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export interface Chunk {
  readonly id: number;
  /** Número de la fuente (`[n]`). */
  readonly n: number;
  readonly text: string;
  /** `snippet`: el extracto que mostró el buscador, no texto de la página (puede estar desactualizado); el resultado lo marca. */
  readonly kind?: "snippet";
}

/** El texto visible de una línea: sin notas al pie, etiquetas HTML ni imágenes; de los enlaces queda el texto. */
function visibleText(line: string): string {
  return line
    // `<sup>`: pegado a un número o a un paréntesis es un exponente u ordinal (`10<sup>9</sup>` → `10^9`, `1<sup>st</sup>` → `1st`) y se conserva; en otro lugar es una
    // nota al pie o una llamada de cita y se quita.
    .replace(/(?<=[\d)])<sup\b[^>]*>([^<]*)<\/sup>/gi, (_, inner: string) => (/^[a-z]+$/i.test(inner.trim()) ? inner.trim() : `^${inner.trim()}`))
    .replace(/<sup\b[^>]*>.*?<\/sup>/gi, "")
    .replace(HTML_TAG, "")
    .replace(/!\[(?:\\.|[^\]\\])*\]\((?:[^()]|\([^()]*\))*\)/g, "") // imágenes: su texto alternativo casi siempre es ruido ("logo", "image")
    .replace(/\[((?:\\.|[^\]\\])*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1") // [texto](destino), también con paréntesis o corchetes escapados dentro
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name: string) => ENTITIES[name])
    .replace(/[ \t ]+/g, " ")
    .trim();
}

/** Líneas útiles de una página, sin los restos de navegación. Conserva los títulos (`#`), las filas de tabla y los bloques de código. */
export function cleanLines(body: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of body.split("\n")) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      out.push(raw.trim());
      continue;
    }
    if (inFence) {
      if (raw.trim() !== "") out.push(raw.replace(/\s+$/, "")); // el código conserva su sangría; sus líneas vacías no cortan el bloque
      continue;
    }
    const line = raw.trim();
    if (line === "") {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (LINKS_ONLY.test(line)) continue;
    const text = visibleText(line);
    if (text === "") continue;
    if (SYMBOLS_ONLY.test(text) && !TABLE_SEPARATOR.test(text)) continue;
    const label = text.replace(/^#+\s*/, "");
    // Un título es contenido ("## Search" en la documentación de una API, "# Cookies" en una página sobre cookies): solo se descartan los que son navegación sin duda.
    if (HEADING.test(text) ? PURE_NAV_HEADING.test(label) : NAV_LABEL.test(label)) continue;
    if (!HEADING.test(text) && text.length <= BOILERPLATE_MAX && NOTICE.test(label)) continue;
    if (!HEADING.test(text) && ACTION.test(label) && label.split(/\s+/).length <= ACTION_MAX_WORDS) continue;
    out.push(text);
  }
  if (inFence) out.push("```"); // un bloque sin cerrar se cierra para que no se trague el resto
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

const key = (line: string): string => fold(line).replace(/\s+/g, " ").trim();

/** Limpia todas las páginas y quita las líneas largas que ya aparecieron antes (en otra fuente o en la misma página). */
export function cleanDocs(docs: readonly Doc[]): { n: number; lines: string[] }[] {
  const seen = new Set<string>();
  return docs.map((doc) => {
    let inFence = false;
    const lines = cleanLines(doc.body).filter((line) => {
      if (FENCE.test(line)) inFence = !inFence;
      if (inFence || line.length < DEDUPE_MIN) return true; // el código no se recorta: un bloque con huecos no sirve
      const k = key(line);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { n: doc.n, lines };
  });
}

// ───────────────────────── Partición ─────────────────────────

interface Paragraph {
  readonly lines: readonly string[];
  readonly heading: boolean;
  /** Encabezado de la tabla (fila de títulos y separador) si el párrafo es una tabla con encabezado. */
  readonly tableHeader?: string;
}

function paragraphsOf(lines: readonly string[]): Paragraph[] {
  const out: Paragraph[] = [];
  let buffer: string[] = [];
  let inFence = false;
  const flush = (): void => {
    if (buffer.length > 0) {
      const isTable = buffer.every((l) => l.startsWith("|"));
      const header = isTable && buffer.length > 2 && TABLE_SEPARATOR.test(buffer[1]) ? `${buffer[0]}\n${buffer[1]}` : undefined;
      // Un encabezado enorme no se repite: ocuparía el lugar de las filas.
      const tableHeader = header !== undefined && header.length <= CHUNK_MAX / 4 ? header : undefined;
      out.push({ lines: buffer, heading: false, ...(tableHeader === undefined ? {} : { tableHeader }) });
    }
    buffer = [];
  };
  for (const line of lines) {
    if (FENCE.test(line)) {
      if (!inFence) flush(); // un bloque de código es un párrafo propio
      buffer.push(line);
      inFence = !inFence;
      if (!inFence) flush();
    } else if (inFence) buffer.push(line);
    else if (line === "") flush();
    else if (HEADING.test(line)) {
      flush();
      out.push({ lines: [line], heading: true });
    } else buffer.push(line);
  }
  flush();
  return out;
}

/** Corta un texto que no cabe en `max` en trozos de hasta `max`, por espacios cuando los hay (nunca a mitad de palabra si se puede evitar). */
function hardSplit(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = rest.lastIndexOf(" ", max);
    const at = cut > max * 0.5 ? cut : max;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest !== "") out.push(rest);
  return out;
}

/** Unidades de un párrafo para empaquetar: sus líneas; una línea que no cabe, por frases; una frase que no cabe, a la fuerza. */
function unitsOf(paragraph: Paragraph, max: number): { text: string; separator: string }[] {
  const units: { text: string; separator: string }[] = [];
  for (const line of paragraph.lines) {
    if (line.length <= max) {
      units.push({ text: line, separator: "\n" });
      continue;
    }
    let first = true;
    for (const sentence of line.split(/(?<=[.!?;:])\s+/)) {
      for (const piece of hardSplit(sentence, max)) {
        units.push({ text: piece, separator: first ? "\n" : " " });
        first = false;
      }
    }
  }
  return units;
}

/**
 * Fragmentos de una página. Reglas, en orden: un título abre fragmento si el actual ya tiene `CHUNK_MIN`; un párrafo que no entra en lo que queda pero sí
 * entraría solo, abre fragmento si el actual ya tiene `CHUNK_MIN`; ninguna unidad pasa `CHUNK_MAX`. Al abrir uno, se repite el último título (y el encabezado
 * de la tabla en curso); un título suelto al final de un fragmento se pasa al siguiente.
 */
export function chunkLines(lines: readonly string[]): string[] {
  const chunks: string[] = [];
  /** Último título visto: el contexto que se repite al abrir un fragmento. */
  let heading: string | undefined;
  let parts: string[] = [];
  let length = 0;
  /** El fragmento actual tiene algo más que títulos. */
  let content = false;
  /** Lo que hay ahora es solo el contexto repetido (un título nuevo lo reemplaza). */
  let seedOnly = false;
  /** Títulos al final de `parts` sin contenido detrás: si se corta ahí, pasan al fragmento siguiente. */
  let trailing = 0;

  const append = (text: string, separator = "\n"): void => {
    length += parts.length === 0 ? text.length : separator.length + text.length;
    parts.push(parts.length === 0 ? text : `${separator}${text}`);
  };
  const flush = (seed: readonly string[]): void => {
    if (content) {
      const kept = parts.slice(0, parts.length - trailing).join("");
      if (kept.length >= CHUNK_FLOOR) chunks.push(kept);
    }
    parts = [];
    length = 0;
    content = false;
    trailing = 0;
    for (const s of seed) append(s);
    seedOnly = seed.length > 0;
  };
  /** Contexto del fragmento siguiente: los títulos que quedaron colgando al final, o el último título. */
  const carry = (): string[] =>
    trailing > 0 ? parts.slice(parts.length - trailing).map((p) => p.replace(/^\n/, "")) : heading === undefined ? [] : [heading];
  const sizeOf = (seed: readonly string[]): number => seed.reduce((a, s) => a + s.length + 1, 0);

  for (const paragraph of paragraphsOf(lines)) {
    if (paragraph.heading) {
      // Un título colgado al final (sin contenido detrás) pasa al fragmento siguiente en vez de perderse.
      if (content && length >= CHUNK_MIN) flush(trailing > 0 ? carry() : []);
      else if (seedOnly) flush([]);
      const line = paragraph.lines[0];
      heading = line.length > HEADING_MAX ? `${line.slice(0, HEADING_MAX).trimEnd()}…` : line;
      append(heading);
      trailing++;
      continue;
    }
    const tableSeed = [...(heading === undefined ? [] : [heading]), ...(paragraph.tableHeader === undefined ? [] : [paragraph.tableHeader])];
    const total = sizeOf(paragraph.lines);
    // Un párrafo que cabría entero en un fragmento nuevo no se parte entre dos (si el actual ya tiene lo suyo).
    if (content && length >= CHUNK_MIN && length + total > CHUNK_MAX && total + sizeOf(carry()) <= CHUNK_MAX) flush(carry());
    const units = unitsOf(paragraph, CHUNK_MAX - Math.max(sizeOf(carry()), sizeOf(tableSeed)));
    units.forEach((unit, i) => {
      if (content && length + unit.separator.length + unit.text.length > CHUNK_MAX) {
        // Dentro de una tabla (pasado su encabezado) se repite el encabezado; si no, el título.
        flush(paragraph.tableHeader !== undefined && i >= 2 ? tableSeed : carry());
      }
      append(unit.text, content ? unit.separator : "\n"); // detrás de un título, siempre en línea nueva
      content = true;
      seedOnly = false;
      trailing = 0;
    });
  }
  flush([]);
  return chunks;
}

export function chunkDocs(docs: readonly Doc[]): Chunk[] {
  const out: Chunk[] = [];
  for (const { n, lines } of cleanDocs(docs)) for (const text of chunkLines(lines)) out.push({ id: out.length, n, text });
  return out;
}

/**
 * El extracto que el buscador mostró de cada fuente, con su título y su fecha de publicación, como un fragmento más: suele contener justo el dato corto
 * (una fecha, una versión) que se perdería entre las páginas completas. Es texto del resultado de búsqueda, no de la página.
 */
/** La fecha de una fuente con su origen: la del extracto del buscador es menos fiable que la que dio la página. */
export const dateLabel = (s: Source): string => `published ${s.date}${s.dateSource === "snippet" ? ", from the search snippet" : ""}`;

export function snippetChunks(sources: readonly Source[], firstId: number): Chunk[] {
  const out: Chunk[] = [];
  for (const s of sources) {
    if (s.snippet === undefined || s.snippet.length < CHUNK_FLOOR) continue;
    out.push({ id: firstId + out.length, n: s.n, kind: "snippet", text: `${s.title} — ${s.snippet}${s.date === undefined ? "" : ` (${dateLabel(s)})`}` });
  }
  return out;
}
