/**
 * JARVIS Core — Mantenimiento de la lista de pendientes del reactivo (funciones puras).
 *
 * La lista la mantiene el código: la genera el modelo al empezar, el código quita el primer ítem cuando su paso termina bien, y
 * solo vuelve a consultar al modelo cuando un paso falla (para reescribir el ítem) o cuando la lista se vacía (para confirmar que
 * no falta nada). Regenerarla completa en cada vuelta hacía que el modelo de 4B borrara ítems pendientes ("guardar el archivo")
 * y volviera a agregar los ya cumplidos.
 *
 * Cuando el modelo sí devuelve una lista (tras un fallo o al vaciarse), `reconcileList` la ajusta con dos reglas:
 *  - no se vuelve a agregar un ítem ya cumplido o abandonado (`settled`);
 *  - los ítems que venían después del reescrito no se pierden: si la lista nueva no los cubre, se agregan al final.
 * "Cubrir" lo decide `sameItem`: mismas palabras que distinguen (por prefijo de 5 letras, sin acentos y sin verbos genéricos), la
 * misma cantidad si los dos ítems traen una y, si los dos nombran algo propio (GPT, Gemini), el mismo. Así "último modelo de GPT" y
 * "último modelo de Gemini", o "10 procesos" y "5 procesos", no se confunden aunque compartan casi todo el resto.
 */

const STOP = new Set(
  "que cual cuales como donde cuando para por con una uno unos unas del los las sus sobre hay esta este ese esa son ser the and for with what which how are you was this that from has have about into obten busca encon infor datos dispo recop tener obtener buscar encontrar informacion data find get search".split(
    " ",
  ),
);

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Prefijos de 5 letras de las palabras que distinguen un ítem. */
function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of fold(text).split(/[^a-z0-9]+/)) {
    if (word.length < 3) continue;
    const stem = word.slice(0, 5);
    if (!STOP.has(word) && !STOP.has(stem)) out.add(stem);
  }
  return out;
}

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
 * La lista que sigue tras una consulta al modelo: `modelList` sin lo ya cumplido o abandonado (`settled`), más los ítems que
 * venían después del primero de `previous` y la lista nueva no cubre. Sin duplicados.
 */
export function reconcileList(modelList: readonly string[], previous: readonly string[], settled: readonly string[]): string[] {
  const items: string[] = [];
  const add = (item: string): void => {
    if (settled.some((s) => sameItem(item, s)) || items.some((i) => sameItem(item, i))) return;
    items.push(item);
  };
  for (const item of modelList) add(item);
  for (const item of previous.slice(1)) add(item);
  return items;
}
