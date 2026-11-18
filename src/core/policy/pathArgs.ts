/**
 * JARVIS Core — Argumentos de herramienta que nombran una ruta (única definición).
 *
 * Antes la lista estaba copiada en `callRunner` (`allowedDirectories`), `precheck`, `sensitivePaths` y `approvalKey`, y no coincidían (la clave de
 * aprobación omitía `cwd`). Quien necesite saber si un argumento es una ruta usa esto; agregar una clave nueva es agregarla acá.
 *
 * `paths` (arreglo de rutas, p. ej. `read_multiple_files`) no es una clave simple y se trata aparte: ver `PATH_LIST_KEY`.
 */

/** Claves de argumentos cuyo valor es una ruta (un string). Incluye `cwd`, la carpeta de trabajo de un comando. */
export const PATH_ARG_KEYS = ["path", "source", "src", "destination", "dest", "directory", "dir", "file", "folder", "cwd"] as const;

/** Clave de argumento cuyo valor es un arreglo de rutas. */
export const PATH_LIST_KEY = "paths";

const PATH_ARG_SET: ReadonlySet<string> = new Set(PATH_ARG_KEYS);

/** ¿Este argumento (su clave, sin distinguir mayúsculas) nombra una ruta? No incluye `paths`. */
export const isPathArgKey = (key: string): boolean => PATH_ARG_SET.has(key.toLowerCase());
