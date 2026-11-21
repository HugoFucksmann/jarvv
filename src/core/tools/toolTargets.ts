/**
 * JARVIS Core — Dónde deja su resultado cada herramienta que escribe en el disco (datos por herramienta, sin lógica).
 *
 * Antes cada consumidor repetía la regla con un `if (tool === "move_file")`: las sondas de ubicación, el aviso de lo escrito en un lugar rechazado y el
 * pre-chequeo. Acá queda una sola tabla; agregar una herramienta que escribe es agregar su fila. Es una hoja sin dependencias: la importan `tools/probes.ts` (que
 * a su vez importa el manifest) y `render/`, así que no puede depender de ellos.
 */

interface WriteTarget {
  /** Argumento que nombra el archivo o la carpeta que la herramienta deja (en un movimiento, el destino). */
  readonly arg: string;
  /** La herramienta no crea las carpetas que contienen el destino: si no existen, falla (`ENOENT`). */
  readonly needsParentFolder: boolean;
}

const WRITE_TARGETS: ReadonlyMap<string, WriteTarget> = new Map<string, WriteTarget>([
  ["write_file", { arg: "path", needsParentFolder: true }],
  ["edit_file", { arg: "path", needsParentFolder: false }],
  ["create_folder", { arg: "path", needsParentFolder: false }],
  ["copy_file", { arg: "destination", needsParentFolder: true }],
  ["move_file", { arg: "destination", needsParentFolder: true }],
  ["archive_files", { arg: "destination", needsParentFolder: false }],
  ["convert_file", { arg: "destination", needsParentFolder: false }],
  ["download_file", { arg: "destination", needsParentFolder: true }],
]);

/** ¿La herramienta crea o reemplaza lo que hay en una ruta (ahí no valen comodines ni nombres que Windows no admite)? */
export const isPathWriteTool = (tool: string): boolean => WRITE_TARGETS.has(tool);

/** El argumento con la ruta que dejó la llamada. Las herramientas que no están en la tabla usan `path`. */
export const placedPathArg = (tool: string): string => WRITE_TARGETS.get(tool)?.arg ?? "path";
