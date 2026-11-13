/**
 * `web_search`: ordenación léxica de los fragmentos (BM25, sin dependencias ni modelos).
 *
 * Tokenización: sin acentos ni mayúsculas, sin las palabras vacías más comunes; las palabras se comparan por su prefijo de 5 letras (sirve en español e inglés
 * sin listas por idioma), los números se comparan enteros (`2024` no es `20241`) y una versión con puntos (`22.0.1`) vale además como un término propio,
 * para que la versión exacta pese más que sus partes sueltas.
 *
 * `coverage` es la fracción de la pregunta que aparece en el fragmento, ponderada por lo que distingue cada término dentro del material (IDF): coincidir solo
 * en las palabras que tienen todos los fragmentos no es cubrir la pregunta. Es lo que decide el estado cuando no hay modelo.
 */

import { fold } from "../../core/text.ts";
import type { Chunk } from "./chunks.ts";

const K1 = 1.2;
const B = 0.75;
/** Fragmentos que pasan al modelo (o al resultado, sin modelo). */
export const CANDIDATES = 15;
/** Máximo de candidatos de una misma fuente: una página larga no acapara la lista. */
export const PER_SOURCE = 3;
/** Cobertura mínima para ser candidato: por debajo, el fragmento solo comparte palabras genéricas con la pregunta. */
export const MIN_COVERAGE = 0.15;
/** Dos candidatos con esta similitud de vocabulario (Jaccard) o más dicen lo mismo: queda el mejor. */
const NEAR_DUPLICATE = 0.8;
/** Un extracto del buscador cuyo vocabulario está al menos en esta fracción dentro de un fragmento de la misma fuente se cuenta como repetido. */
const SNIPPET_CONTAINED = 0.85;
/** Un fragmento muy corto (un extracto) no gana puntos solo por ser corto: su largo cuenta como mínimo esta fracción del promedio. */
const MIN_LENGTH_RATIO = 0.5;

const STOP = new Set(
  (
    "que cual cuales como donde cuando para por con una uno unos unas del los las sus sobre hay esta este ese esa esto eso estos estas son ser fue " +
    "han mas pero muy ya no si el la lo le les de al en un se su es me te mi tu nos sin entre desde hasta cada otro otra tambien " +
    "the and for with what which how are you was were this that from has have had about into not but all can will its their there than then who whom why " +
    "when where does did an of to in on at is it be as by or if so do we he she they"
  ).split(" "),
);

const VERSION = /\d+(?:\.\d+)+/g;
const NUMBER = /^\d+$/;
/** Escrituras sin espacios entre palabras (chino, japonés): se comparan por pares de caracteres seguidos. */
const UNSPACED = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+)/u;

function pushWord(word: string, out: string[]): void {
  if (word === "") return;
  if (NUMBER.test(word)) {
    out.push(word); // los números, enteros y de cualquier largo ("Python 3")
    return;
  }
  if (word.length < 2 || STOP.has(word)) return;
  out.push(word.slice(0, 5));
}

/** Términos de un texto, con repeticiones (para contar frecuencias). */
export function tokenize(text: string): string[] {
  // `fold` quita los acentos latinos; las marcas que quedan (dakuten japonés, vocales del devanagari) se recomponen y son parte de la palabra.
  const folded = fold(text).normalize("NFC");
  const out: string[] = [];
  for (const word of folded.split(/[^\p{L}\p{N}\p{M}]+/u)) {
    if (!UNSPACED.test(word)) {
      pushWord(word, out);
      continue;
    }
    // "澳大利亚的首都" no tiene separadores: sin pares de caracteres sería un solo término que nunca coincide con nada.
    word.split(UNSPACED).forEach((run, i) => {
      if (i % 2 === 0) pushWord(run, out);
      else if (run.length === 1) out.push(run);
      else for (let j = 0; j < run.length - 1; j++) out.push(run.slice(j, j + 2));
    });
  }
  for (const version of folded.match(VERSION) ?? []) out.push(version);
  return out;
}

export interface Ranked {
  readonly chunk: Chunk;
  /** Relevancia final: BM25 ajustado por la cobertura. */
  readonly score: number;
  readonly coverage: number;
  /** Términos distintos del fragmento (para detectar repetidos). */
  readonly terms: ReadonlySet<string>;
}

interface Indexed {
  readonly chunk: Chunk;
  readonly tf: Map<string, number>;
  readonly length: number;
}

/** Peso de cada término de un grupo para la cobertura: su IDF; el que no aparece en ningún fragmento pesa el promedio de los que sí (no informa a cuál). */
function weights(group: readonly string[], idf: ReadonlyMap<string, number>, df: ReadonlyMap<string, number>): Map<string, number> {
  const present = group.filter((t) => (df.get(t) ?? 0) > 0).map((t) => idf.get(t) ?? 0);
  const fallback = present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : 1;
  return new Map(group.map((t) => [t, (df.get(t) ?? 0) > 0 ? (idf.get(t) ?? 0) : fallback]));
}

function coverageOf(doc: Indexed, group: ReadonlyMap<string, number>): number {
  let total = 0;
  let matched = 0;
  for (const [term, w] of group) {
    total += w;
    if (doc.tf.has(term)) matched += w;
  }
  return total > 0 ? matched / total : 0;
}

/** Todos los fragmentos con puntaje, del mayor al menor (los de puntaje 0 no se devuelven). */
export function rank(chunks: readonly Chunk[], need: string): { ranked: Ranked[]; terms: number } {
  const query = [...new Set(tokenize(need))];
  if (query.length === 0 || chunks.length === 0) return { ranked: [], terms: query.length };

  const docs: Indexed[] = chunks.map((chunk) => {
    const tf = new Map<string, number>();
    const tokens = tokenize(chunk.text);
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { chunk, tf, length: tokens.length };
  });
  const average = docs.reduce((a, d) => a + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  const idf = new Map<string, number>();
  for (const term of query) {
    const n = docs.filter((d) => d.tf.has(term)).length;
    df.set(term, n);
    idf.set(term, Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)));
  }
  const group = weights(query, idf, df);

  const ranked: Ranked[] = [];
  for (const d of docs) {
    const norm = K1 * (1 - B + (B * Math.max(d.length, average * MIN_LENGTH_RATIO)) / average);
    let bm25 = 0;
    for (const term of query) {
      const f = d.tf.get(term) ?? 0;
      if (f > 0) bm25 += ((idf.get(term) ?? 0) * f * (K1 + 1)) / (f + norm);
    }
    if (bm25 <= 0) continue;
    const coverage = coverageOf(d, group);
    // A igual BM25, el fragmento que cubre más de la pregunta va antes que el que repite una sola palabra.
    ranked.push({ chunk: d.chunk, score: bm25 * (0.5 + 0.5 * coverage), coverage, terms: new Set(d.tf.keys()) });
  }
  ranked.sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.chunk.id - b.chunk.id);
  return { ranked, terms: query.length };
}

/** Fracción del más chico que está en el otro: un extracto corto dentro de un fragmento largo da Jaccard bajo, pero es lo mismo dicho dos veces. */
function containment(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return 0;
  let shared = 0;
  for (const t of small) if (large.has(t)) shared++;
  return shared / small.size;
}

/** Dos candidatos dicen lo mismo: casi el mismo vocabulario, o un extracto del buscador contenido casi entero en un fragmento de la misma fuente. */
function repeats(a: Ranked, b: Ranked): boolean {
  if (jaccard(a.terms, b.terms) >= NEAR_DUPLICATE) return true;
  const oneIsSnippet = a.chunk.kind === "snippet" || b.chunk.kind === "snippet";
  return oneIsSnippet && a.chunk.n === b.chunk.n && containment(a.terms, b.terms) >= SNIPPET_CONTAINED;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Los mejores `limit` fragmentos con cobertura suficiente, a lo sumo `perSource` de cada fuente y sin casi repetidos. */
export function pickCandidates(ranked: readonly Ranked[], limit = CANDIDATES, perSource = PER_SOURCE, minCoverage = MIN_COVERAGE): Ranked[] {
  const taken = new Map<number, number>();
  const out: Ranked[] = [];
  for (const r of ranked) {
    if (r.coverage < minCoverage) continue;
    const count = taken.get(r.chunk.n) ?? 0;
    if (count >= perSource) continue;
    const same = out.findIndex((o) => repeats(o, r));
    if (same >= 0) {
      // Un extracto que la página repite: queda el texto de la página (más completo y literal), en el lugar que ocupaba el extracto.
      if (out[same].chunk.kind === "snippet" && r.chunk.kind !== "snippet" && out[same].chunk.n === r.chunk.n) out[same] = r;
      continue;
    }
    taken.set(r.chunk.n, count + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
