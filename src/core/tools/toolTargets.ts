/**
 * JARVIS Core — Dónde deja su resultado cada herramienta que escribe en el disco (datos por herramienta, sin lógica).
 *
 * Antes cada consumidor repetía la regla con un `if (tool === "move_file")`: las sondas de ubicación, el aviso de lo escrito en un lugar rechazado y el
 * pre-chequeo. Acá queda una sola tabla; agregar una herramienta que escribe es agregar su fila. Es una hoja sin dependencias: la importan `tools/probes.ts` (que
 * a su vez importa el manifest) y `render/`, así que no puede depender de ellos.
 */

/** Argumento que nombra el archivo o la carpeta que deja cada herramienta que escribe (en un movimiento, el destino). */
const WRITE_TARGET_ARG: ReadonlyMap<string, string> = new Map<string, string>([
  ["write_file", "path"],
  ["edit_file", "path"],
  ["create_folder", "path"],
  ["copy_file", "destination"],
  ["move_file", "destination"],
  ["archive_files", "destination"],
  ["convert_file", "destination"],
  ["download_file", "destination"],
]);

/** ¿La herramienta crea o reemplaza lo que hay en una ruta (ahí no valen comodines ni nombres que Windows no admite)? */
export const isPathWriteTool = (tool: string): boolean => WRITE_TARGET_ARG.has(tool);

/** El argumento con la ruta que dejó la llamada. Las herramientas que no están en la tabla usan `path`. */
export const placedPathArg = (tool: string): string => WRITE_TARGET_ARG.get(tool) ?? "path";
