/**
 * `web_search`: limpieza del texto de las páginas y partición en fragmentos.
 *
 * Limpieza (por línea, sin modelos): fuera los enlaces sueltos, los restos de navegación y banners (cortos), las líneas de solo símbolos y las que ya
 * aparecieron en otra fuente; los destinos de los enlaces `[texto](url)` se quitan y queda el texto. Partición: por títulos y párrafos, de
 * `CHUNK_MIN` a `CHUNK_MAX` caracteres, cada fragmento con el número de su fuente. El texto de un fragmento es literal (nunca se resume ni se reescribe).
 */

import { fold } from "../../core/text.ts";
import type { Doc } from "./report.ts";

export const CHUNK_MIN = 500;
export const CHUNK_MAX = 800;
/** Un fragmento más corto que esto no dice nada por sí solo. */
const CHUNK_FLOOR = 40;
/** Solo las líneas de este largo o más se comparan entre fuentes para quitar repetidos. */
const DEDUPE_MIN = 40;
/** Las líneas de navegación y banners son cortas: una línea larga con esas palabras es contenido. */
const BOILERPLATE_MAX = 120;

const LINKS_ONLY = /^\s*(?:[-*•·|]\s*)*(?:!?\[[^\]]*\]\([^)]*\)\s*(?:[-*•·|]\s*)*)+$/;
/** Frases con las que empiezan los avisos y la navegación (inglés y español). */
const BOILERPLATE = new RegExp(
  "^(?:" +
    [
      "skip to (?:main )?content", "accept(?: all)? cookies?", "we use cookies", "cookie (?:settings|policy|preferences)", "subscribe(?: to our newsletter)?",
      "sign (?:in|up)", "log ?in", "all rights reserved", "privacy policy", "terms (?:of use|of service|and conditions)", "share (?:on|this)", "follow us",
      "read more", "related (?:articles|posts)",
      "ir al contenido", "acept(?:ar|o)(?: todas)?(?: las)? cookies?", "usamos cookies", "configuraci[oó]n de cookies", "suscr[ií]bete", "iniciar sesi[oó]n",
      "reg[ií]strate", "todos los derechos reservados", "pol[ií]tica de (?:privacidad|cookies)", "t[eé]rminos y condiciones", "compartir en", "s[ií]guenos",
      "leer m[aá]s", "art[ií]culos relacionados",
    ].join("|") +
    ")(?![\\p{L}])",
  "iu",
);
/** Etiquetas de navegación que, solas en una línea, no son contenido. */
const NAV_LABEL = /^(?:menu|men[uú]|search|buscar|newsletter|bolet[ií]n|back to top|volver arriba|advertisement|publicidad|cookies)[\s:.]*$/i;
const SYMBOLS_ONLY = /^[\W_]+$/u;

export interface Chunk {
  readonly id: number;
  /** Número de la fuente (`[n]`). */
  readonly n: number;
  readonly text: string;
}

/** Líneas útiles de una página, sin los restos de navegación. Conserva los títulos (`#`) y las filas de tabla. */
export function cleanLines(body: string): string[] {
  const out: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (LINKS_ONLY.test(line)) continue;
    const text = line
      .replace(/<sup\b[^>]*>.*?<\/sup>/gi, "") // notas al pie y llamadas de cita
      .replace(/<\/?[a-z][^>]*>/gi, "") // el resto de las etiquetas HTML sueltas
      .replace(/!?\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, "$1") // [texto](destino): queda el texto (también con corchetes escapados dentro)
      .replace(/[ \t]+/g, " ")
      .trim();
    if (text === "" || SYMBOLS_ONLY.test(text)) continue;
    const label = text.replace(/^#+\s*/, "");
    if (NAV_LABEL.test(label) || (text.length <= BOILERPLATE_MAX && BOILERPLATE.test(label))) continue;
    out.push(text);
  }
  return out;
}

const key = (line: string): string => fold(line).replace(/\s+/g, " ");

/** Limpia todas las páginas y quita de las posteriores las líneas largas que ya aparecieron en una anterior. */
export function cleanDocs(docs: readonly Doc[]): { n: number; lines: string[] }[] {
  const seen = new Set<string>();
  return docs.map((doc) => {
    const lines = cleanLines(doc.body).filter((line) => {
      if (line.length < DEDUPE_MIN) return true;
      const k = key(line);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { n: doc.n, lines };
  });
}

/**
 * Un párrafo largo se parte por sus líneas (una fila de tabla o un elemento de lista no se corta por la mitad) y, dentro de una línea larga, por frases;
 * una frase que sola no cabe se corta a la fuerza. Las partes se unen con el mismo separador que tenían (salto de línea o espacio) hasta `CHUNK_MAX`.
 */
function splitLong(paragraph: string): string[] {
  if (paragraph.length <= CHUNK_MAX) return [paragraph];
  const parts: string[] = [];
  let current = "";
  const push = (piece: string): void => {
    for (let i = 0; i < piece.length; i += CHUNK_MAX) parts.push(piece.slice(i, i + CHUNK_MAX));
  };
  const add = (piece: string, separator: string): void => {
    if (current.length > 0 && current.length + separator.length + piece.length > CHUNK_MAX) {
      push(current);
      current = "";
    }
    current = current === "" ? piece : `${current}${separator}${piece}`;
  };
  for (const line of paragraph.split("\n")) {
    if (line.length <= CHUNK_MAX) add(line, "\n");
    else for (const sentence of line.split(/(?<=[.!?])\s+/)) add(sentence, " ");
  }
  if (current !== "") push(current);
  return parts;
}

/** Fragmentos de una página: párrafos unidos hasta `CHUNK_MAX`; un título abre fragmento nuevo si el anterior ya tiene `CHUNK_MIN`. */
export function chunkLines(lines: readonly string[]): string[] {
  const paragraphs: { text: string; heading: boolean }[] = [];
  let buffer: string[] = [];
  const flush = (): void => {
    if (buffer.length > 0) paragraphs.push({ text: buffer.join("\n"), heading: false });
    buffer = [];
  };
  for (const line of lines) {
    if (line === "") flush();
    else if (line.startsWith("#")) {
      flush();
      paragraphs.push({ text: line, heading: true });
    } else buffer.push(line);
  }
  flush();

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    for (const piece of splitLong(paragraph.text)) {
      const startsNew = (paragraph.heading && current.length >= CHUNK_MIN) || (current.length > 0 && current.length + piece.length + 2 > CHUNK_MAX);
      if (startsNew) {
        chunks.push(current);
        current = "";
      }
      current = current === "" ? piece : `${current}\n${piece}`;
    }
  }
  if (current !== "") chunks.push(current);
  return chunks.filter((text) => text.length >= CHUNK_FLOOR);
}

export function chunkDocs(docs: readonly Doc[]): Chunk[] {
  const out: Chunk[] = [];
  for (const { n, lines } of cleanDocs(docs)) for (const text of chunkLines(lines)) out.push({ id: out.length, n, text });
  return out;
}
