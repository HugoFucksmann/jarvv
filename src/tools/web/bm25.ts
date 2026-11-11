/**
 * `web_search`: ordenación léxica de los fragmentos (BM25, sin dependencias ni modelos).
 *
 * Las palabras se comparan por su prefijo de 5 letras y sin acentos (sirve en español e inglés sin listas por idioma) y sin las palabras vacías más comunes.
 * `coverage` es la fracción de las palabras de la pregunta que aparecen en el fragmento: es lo que decide el estado cuando no hay modelo.
 */

import { fold } from "../../core/text.ts";
import type { Chunk } from "./chunks.ts";

const K1 = 1.2;
const B = 0.75;
/** Fragmentos que pasan al modelo (o al resultado, sin modelo). */
export const CANDIDATES = 15;
/** Máximo de candidatos de una misma fuente: una página larga no acapara la lista. */
export const PER_SOURCE = 3;

const STOP = new Set(
  (
    "que cual cuales como donde cuando para por con una uno unos unas del los las sus sobre hay esta este ese esa son ser fue era mas pero muy ya no si " +
    "el la lo le les de al en un se su es me te mi tu nos sin entre desde hasta cada otro otra tambien " +
    "the and for with what which how are you was were this that from has have had about into not but all can will its their there than then who whom why " +
    "an of to in on at is it be as by or if so do we he she they"
  ).split(" "),
);

/** Prefijos de las palabras de un texto, con repeticiones (para contar frecuencias). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const word of fold(text).split(/[^a-z0-9]+/)) {
    if (word.length < 2 || STOP.has(word)) continue;
    out.push(word.slice(0, 5));
  }
  return out;
}

export interface Ranked {
  readonly chunk: Chunk;
  readonly score: number;
  readonly coverage: number;
}

/** Todos los fragmentos con puntaje, del mayor al menor (los de puntaje 0 no se devuelven). */
export function rank(chunks: readonly Chunk[], queryText: string): { ranked: Ranked[]; terms: number } {
  const query = [...new Set(tokenize(queryText))];
  if (query.length === 0 || chunks.length === 0) return { ranked: [], terms: query.length };

  const docs = chunks.map((chunk) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(chunk.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { chunk, tf, length: [...tf.values()].reduce((a, b) => a + b, 0) };
  });
  const average = docs.reduce((a, d) => a + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const term of query) df.set(term, docs.filter((d) => d.tf.has(term)).length);

  const ranked: Ranked[] = [];
  for (const d of docs) {
    let score = 0;
    let matched = 0;
    for (const term of query) {
      const f = d.tf.get(term) ?? 0;
      if (f === 0) continue;
      matched++;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / average));
    }
    if (score > 0) ranked.push({ chunk: d.chunk, score, coverage: matched / query.length });
  }
  ranked.sort((a, b) => b.score - a.score || a.chunk.id - b.chunk.id);
  return { ranked, terms: query.length };
}

/** Los mejores `limit` fragmentos, con a lo sumo `perSource` de cada fuente. */
export function pickCandidates(ranked: readonly Ranked[], limit = CANDIDATES, perSource = PER_SOURCE): Ranked[] {
  const taken = new Map<number, number>();
  const out: Ranked[] = [];
  for (const r of ranked) {
    const count = taken.get(r.chunk.n) ?? 0;
    if (count >= perSource) continue;
    taken.set(r.chunk.n, count + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
