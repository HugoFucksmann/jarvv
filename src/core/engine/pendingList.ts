/**
 * JARVIS Core — Mantenimiento de la lista de pendientes del reactivo (funciones puras).
 *
 * La lista la mantiene el código: la genera el modelo al empezar, el código quita el primer ítem cuando su paso termina bien, y
 * solo vuelve a consultar al modelo cuando un paso falla (para reescribir el ítem) o cuando la lista se vacía (para confirmar que
 * no falta nada). Regenerarla completa en cada vuelta hacía que el modelo de 4B borrara ítems pendientes ("guardar el archivo")
 * y volviera a agregar los ya cumplidos.
 *
 * Cuando el modelo sí devuelve una lista (tras un fallo o al vaciarse), `reconcileList` la ajusta con tres reglas:
 *  - el modelo no vuelve a agregar un ítem ya cumplido o abandonado (`settled`);
 *  - un ítem repetido seguido es un duplicado, pero uno que vuelve después de otro distinto es un pedido ("corré las pruebas, cambiá X y volvé a
 *    correrlas"): se conserva (RC-21);
 *  - los ítems que venían después del reescrito no se pierden: si la lista nueva no los cubre, se agregan al final. Son pendientes que el código ya
 *    tenía (no los agrega el modelo), así que no se descartan por parecerse a uno cumplido.
 * "Cubrir" lo decide `sameItem`: mismas palabras que distinguen (por prefijo de 5 letras, sin acentos y sin verbos genéricos), la
 * misma cantidad si los dos ítems traen una y, si los dos nombran algo propio (GPT, Gemini), el mismo. Así "último modelo de GPT" y
 * "último modelo de Gemini", o "10 procesos" y "5 procesos", no se confunden aunque compartan casi todo el resto.
 */

import { fold, stemsOf } from "../text.ts";

const STOP = new Set(
  "que cual cuales como donde cuando para por con una uno unos unas del los las sus sobre hay esta este ese esa son ser the and for with what which how are you was this that from has have about into obten busca encon infor datos dispo recop tener obtener buscar encontrar informacion data find get search".split(
    " ",
  ),
);

const stems = (text: string): Set<string> => stemsOf(text, STOP);

/** Nombres propios y cifras del ítem (sin contar la primera palabra, que va en mayúscula por ser el verbo). */
function proper(text: string): Set<string> {
  const out = new Set<string>();
  const words = text.match(/[A-Za-z0-9À-ſ][\w.+À-ſ-]*/g) ?? [];
  words.slice(1).forEach((w) => {
    if (/^[A-ZÀ-Ü]/.test(w) || /\d/.test(w)) out.add(fold(w).replace(/[.+-]+$/, ""));
  });
  return out;
}

const normalized = (s: string): string => fold(s).replace(/[^a-z0-9]+/g, " ").trim();

/** ¿Dos ítems piden lo mismo? */
export function sameItem(a: string, b: string): boolean {
  const sa = stems(a);
  const sb = stems(b);
  if (sa.size === 0 || sb.size === 0) return normalized(a) === normalized(b);
  const na = new Set(a.match(/\d+/g) ?? []);
  const nb = new Set(b.match(/\d+/g) ?? []);
  if (na.size > 0 && nb.size > 0 && ![...na].some((n) => nb.has(n))) return false;
  const pa = proper(a);
  const pb = proper(b);
  if (pa.size > 0 && pb.size > 0 && ![...pa].some((p) => pb.has(p))) return false;
  const shared = [...sa].filter((s) => sb.has(s)).length;
  return shared / Math.min(sa.size, sb.size) >= 0.6;
}

/**
 * La lista que sigue tras una consulta al modelo: `modelList` sin lo ya cumplido o abandonado (`settled`) ni duplicados seguidos, más los ítems que
 * venían después del primero de `previous` y la lista nueva no cubre.
 */
export function reconcileList(modelList: readonly string[], previous: readonly string[], settled: readonly string[]): string[] {
  const items: string[] = [];
  for (const item of modelList) {
    if (settled.some((s) => sameItem(item, s))) continue;
    if (items.length > 0 && sameItem(item, items[items.length - 1])) continue;
    items.push(item);
  }
  for (const item of previous.slice(1)) {
    if (!items.some((i) => sameItem(item, i))) items.push(item);
  }
  return items;
}
