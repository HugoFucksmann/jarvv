/**
 * JARVIS Core — Argumentos de herramienta que nombran una ruta (única definición).
 *
 * Antes la lista estaba copiada en `callRunner` (`allowedDirectories`), `precheck`, `sensitivePaths` y `approvalKey`, y no coincidían (la clave de
 * aprobación omitía `cwd`). Quien necesite saber si un argumento es una ruta usa esto; agregar una clave nueva es agregarla acá.
 *
 * `paths` (arreglo de rutas) no es una clave simple y se trata aparte: ver `PATH_LIST_KEY`.
 */

/** Claves de argumentos cuyo valor es una ruta (un string). Incluye `cwd`, la carpeta de trabajo de un comando. */
export const PATH_ARG_KEYS = ["path", "source", "src", "destination", "dest", "directory", "dir", "file", "folder", "cwd"] as const;

/** Clave de argumento cuyo valor es un arreglo de rutas. */
export const PATH_LIST_KEY = "paths";

const PATH_ARG_SET: ReadonlySet<string> = new Set(PATH_ARG_KEYS);

/** ¿Este argumento (su clave, sin distinguir mayúsculas) nombra una ruta? No incluye `paths`. */
export const isPathArgKey = (key: string): boolean => PATH_ARG_SET.has(key.toLowerCase());

/**
 * Los argumentos como pares clave/valor con los lotes expandidos: cada ruta de `sources` queda como un `source` y cada par de `items` como un `source` y un `destination`.
 * Quien revise rutas (Guard, aprobaciones, pre-chequeo, `allowedDirectories`) recorre esto en vez de `Object.entries(args)`, así una ruta dentro de un lote no se escapa.
 */
export function expandedArgEntries(args: Readonly<Record<string, unknown>>): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(args)) {
    const k = key.toLowerCase();
    if (k === "sources" && Array.isArray(value)) {
      for (const v of value) out.push(["source", v]);
    } else if (k === "items" && Array.isArray(value)) {
      for (const item of value) {
        if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
        const pair = item as Record<string, unknown>;
        if ("source" in pair) out.push(["source", pair.source]);
        if ("destination" in pair) out.push(["destination", pair.destination]);
      }
    } else {
      out.push([key, value]);
    }
  }
  return out;
}

/** Todas las rutas de los argumentos (claves simples, listas y lotes), sin vacíos. */
export function pathValuesOf(args: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const [key, value] of expandedArgEntries(args)) {
    const k = key.toLowerCase();
    if (!isPathArgKey(k) && k !== PATH_LIST_KEY) continue;
    const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
    for (const v of values) if (typeof v === "string" && v.trim() !== "") out.push(v);
  }
  return out;
}
