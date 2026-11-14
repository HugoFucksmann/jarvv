/**
 * JARVIS Core — Memoria de hechos del usuario (Frente 1, capa 1; primer corte: solo archivo editable).
 *
 * `data/memory.json` (junto a `refsDir`) guarda pares clave → valor que el usuario escribió a mano («carpeta jarvis» → su ruta). El código elige los
 * que coinciden con el pedido (todas las palabras de la clave aparecen, por prefijo de 5 letras) y solo esos, hasta `MAX_FACTS_PER_PROMPT`, van al
 * prompt de argumentos y a las fuentes del pre-chequeo. Sin coincidencia: cero tokens. Ningún modelo participa y nunca se escribe texto generado.
 *
 * Medido (docs/analisis/FRENTE_1_MEMORIA.md): con el hecho en el prompt el generativo pasa de 0/6 a 6/6 en pedidos que dependen de algo ya dicho; elegir por
 * código acierta 14/14 y no contamina pedidos ajenos (0/8; pasar todos contaminaba 1 de 8).
 *
 * Formato: `[{ "key": "carpeta jarvis", "value": "C:\\Users\\Ana\\Desktop\\jarvis" }]` (también `{ "facts": [...] }`). Un archivo ausente o inválido es
 * una memoria vacía, nunca un error de la tarea.
 */

import fs from "node:fs";

import { stemsOf } from "./text.ts";

export interface MemoryFact {
  readonly key: string;
  readonly value: string;
}

/** Tope de hechos que se pasan en una misma generación (DN-1.9). */
export const MAX_FACTS_PER_PROMPT = 3;
/** Tope de entradas que se leen del archivo y de caracteres por clave y valor: la memoria no puede inflar el prompt. */
const MAX_FACTS = 200;
const MAX_KEY_CHARS = 80;
const MAX_VALUE_CHARS = 300;

const STOP = new Set(
  "que cual cuales como donde cuando para por con una uno unos unas del los las sus sobre hay esta este ese esa son ser mis mio mia the and for with what which how are you was this that from my".split(
    " ",
  ),
);

const stems = (text: string): Set<string> => stemsOf(text, STOP);

/** Los hechos válidos de un JSON ya parseado; descarta lo que no tenga clave y valor de texto. */
export function parseFacts(raw: unknown): MemoryFact[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "object" && raw !== null && Array.isArray((raw as { facts?: unknown }).facts) ? (raw as { facts: unknown[] }).facts : [];
  const out: MemoryFact[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const { key, value } = item as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || typeof value !== "string") continue;
    const k = key.trim();
    const v = value.trim();
    if (k === "" || v === "" || k.length > MAX_KEY_CHARS || v.length > MAX_VALUE_CHARS) continue;
    out.push({ key: k, value: v });
    if (out.length >= MAX_FACTS) break;
  }
  return out;
}

/**
 * Los hechos cuya clave aparece completa en `text` (todas sus palabras que distinguen, por prefijo). Orden del archivo, hasta `max`. Una clave sin
 * palabras que distingan (todo palabras vacías) no coincide nunca.
 */
export function selectFacts(text: string, facts: readonly MemoryFact[], max: number = MAX_FACTS_PER_PROMPT): MemoryFact[] {
  if (facts.length === 0 || text.trim() === "") return [];
  const have = stems(text);
  const picked: MemoryFact[] = [];
  for (const fact of facts) {
    const need = stems(fact.key);
    if (need.size === 0) continue;
    if ([...need].every((s) => have.has(s))) picked.push(fact);
    if (picked.length >= max) break;
  }
  return picked;
}

/** Líneas para el bloque `MEMORY` del prompt: `clave: valor`. */
export const factLines = (facts: readonly MemoryFact[]): string[] => facts.map((f) => `${f.key}: ${f.value}`);

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
