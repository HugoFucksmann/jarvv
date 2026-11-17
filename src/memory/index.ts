/**
 * Paquete independiente de memoria de hechos del usuario (`data/memory.json`).
 *
 * No depende de `src/core/` ni conoce `TaskContext`. Es dueño de su formato,
 * parsing, matching determinista y topes.
 *
 * Formato: `[{ "key": "...", "value": "...", "aliases"?: ["..."] }]` (o `{ "facts": [...] }`).
 * Un archivo ausente o inválido es una memoria vacía, nunca un error de la tarea.
 */

import fs from "node:fs";

/** Un hecho guardado por el usuario. */
export interface MemoryFact {
  readonly key: string;
  readonly value: string;
  readonly aliases?: readonly string[];
}

/** Aporte devuelto por `MemoryProvider.recall`. */
export interface Recalled {
  readonly key: string;
  readonly value: string;
}

/** Puerto mínimo v1 de memoria externa: solo lectura determinista. */
export interface MemoryProvider {
  recall(text: string, limit?: number): Promise<readonly Recalled[]>;
}

/** Tope de hechos que se pasan en una misma generación (DN-1.9). */
export const MAX_FACTS_PER_PROMPT = 3;
/** Tope de entradas que se leen del archivo y de caracteres por clave y valor: la memoria no puede inflar el prompt. */
export const MAX_FACTS = 200;
export const MAX_KEY_CHARS = 80;
export const MAX_VALUE_CHARS = 300;

const STOP = new Set(
  "que cual cuales como donde cuando para por con una uno unos unas del los las sus sobre hay esta este ese esa son ser mis mio mia the and for with what which how are you was this that from my".split(
    " ",
  ),
);

/** Minúsculas y sin acentos. */
export const fold = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Recorte mínimo de plurales regulares (`-s`) sin tocar palabras de < 4 letras ni `-ss`/`-us`/`-is`. */
function normalizePlural(word: string): string {
  if (word.length >= 4 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) {
    return word.slice(0, -1);
  }
  return word;
}

/** Prefijos de 5 letras (o la palabra entera) de las palabras distintivas de `text`, sin las de `STOP`. */
export function stemsOf(text: string, stop: ReadonlySet<string> = STOP): Set<string> {
  const out = new Set<string>();
  for (const word of fold(text).split(/[^a-z0-9]+/)) {
    if (word.length < 3 || stop.has(word)) continue;
    const singular = normalizePlural(word);
    const stem = singular.slice(0, 5);
    if (!stop.has(singular) && !stop.has(stem)) out.add(stem);
  }
  return out;
}

/** Los hechos válidos de un JSON ya parseado; descarta lo que no tenga clave y valor de texto dentro de los topes. */
export function parseFacts(raw: unknown): MemoryFact[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { facts?: unknown }).facts)
      ? (raw as { facts: unknown[] }).facts
      : [];
  const out: MemoryFact[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const { key, value, aliases } = item as { key?: unknown; value?: unknown; aliases?: unknown };
    if (typeof key !== "string" || typeof value !== "string") continue;
    const k = key.trim();
    const v = value.trim();
    if (k === "" || v === "" || k.length > MAX_KEY_CHARS || v.length > MAX_VALUE_CHARS) continue;
    let validAliases: string[] | undefined;
    if (Array.isArray(aliases)) {
      const seen = new Set<string>([k]);
      const collected: string[] = [];
      for (const rawAlias of aliases) {
        if (typeof rawAlias !== "string") continue;
        const trimmed = rawAlias.trim();
        if (trimmed === "" || trimmed.length > MAX_KEY_CHARS || seen.has(trimmed)) continue;
        seen.add(trimmed);
        collected.push(trimmed);
      }
      if (collected.length > 0) validAliases = collected;
    }
    out.push(validAliases === undefined ? { key: k, value: v } : { key: k, value: v, aliases: validAliases });
    if (out.length >= MAX_FACTS) break;
  }
  return out;
}

/**
 * Los hechos cuya clave (o alguno de sus alias) aparece completa en `text` (todas sus palabras que distinguen, por prefijo).
 * Prioriza las coincidencias más específicas (mayor cantidad de stems), desempatando por orden del archivo, hasta `max`.
 */
export function selectFacts(text: string, facts: readonly MemoryFact[], max: number = MAX_FACTS_PER_PROMPT): MemoryFact[] {
  if (facts.length === 0 || text.trim() === "" || max <= 0) return [];
  const have = stemsOf(text);
  if (have.size === 0) return [];
  const matches: { readonly fact: MemoryFact; readonly score: number; readonly index: number }[] = [];
  for (let index = 0; index < facts.length; index++) {
    const fact = facts[index];
    let bestScore = 0;
    const candidates = fact.aliases ? [fact.key, ...fact.aliases] : [fact.key];
    for (const candidate of candidates) {
      const need = stemsOf(candidate);
      if (need.size === 0) continue;
      if ([...need].every((s) => have.has(s)) && need.size > bestScore) {
        bestScore = need.size;
      }
    }
    if (bestScore > 0) matches.push({ fact, score: bestScore, index });
  }
  matches.sort((a, b) => b.score - a.score || a.index - b.index);
  return matches.slice(0, max).map((m) => m.fact);
}

/** Líneas para el bloque `MEMORY`: `clave: valor`. */
export const factLines = (facts: readonly Recalled[]): string[] => facts.map((f) => `${f.key}: ${f.value}`);

/**
 * Lector del archivo con caché por fecha de modificación: se edita a mano con Jarvis encendido y el cambio se ve en la tarea siguiente, sin releer el
 * disco en cada generación.
 */
export function createMemoryReader(file: string): () => readonly MemoryFact[] {
  let cached: { mtimeMs: number; facts: MemoryFact[] } | null = null;
  return () => {
    try {
      const { mtimeMs } = fs.statSync(file);
      if (cached !== null && cached.mtimeMs === mtimeMs) return cached.facts;
      const facts = parseFacts(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
      cached = { mtimeMs, facts };
      return facts;
    } catch {
      cached = null;
      return [];
    }
  };
}

/** Proveedor de memoria respaldado por un archivo JSON (`data/memory.json`). */
export function createJsonMemoryProvider(file: string): MemoryProvider {
  const read = createMemoryReader(file);
  return {
    async recall(text: string, limit: number = MAX_FACTS_PER_PROMPT): Promise<readonly Recalled[]> {
      return selectFacts(text, read(), limit);
    },
  };
}
