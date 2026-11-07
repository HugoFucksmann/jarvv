/**
 * JARVIS Core — Lectura de la traza ya escrita de una tarea (solo lectura, para la API).
 *
 * `recorder.ts` escribe una carpeta por tarea terminada (`<base>/AAAAMMDD-HHMMSS_<id>/`); aquí se busca por el id y se devuelve
 * el texto de uno de sus archivos pequeños. `full.json.gz` no se sirve: es grande y es para análisis fuera de la UI. El backend
 * nunca usa estos archivos para decidir nada.
 */

import fs from "node:fs";
import path from "node:path";

import { ConfigManager } from "../config.ts";

/** Archivos que se pueden leer: nombre en la API → archivo en la carpeta. */
export const TRACE_FILES = { summary: "summary.md", json: "trace.json" } as const;
export type TraceFile = keyof typeof TRACE_FILES;

/** Mismo saneado del id que `folderName` (`format.ts`). */
const folderId = (taskId: string): string => taskId.replace(/[^A-Za-z0-9._-]/g, "_");

/** Largo de `AAAAMMDD-HHMMSS_`, el prefijo de la carpeta antes del id. */
const STAMP_CHARS = 16;

/** Texto del archivo de la traza de la tarea; `null` si la traza está desactivada, la tarea no terminó o el archivo no existe. */
export function readTraceFile(taskId: string, which: TraceFile): string | null {
  try {
    const file = path.resolve(process.cwd(), ConfigManager.getConfig().tracePath);
    const base = path.join(path.dirname(file), path.basename(file, path.extname(file)));
    // Id exacto: uno parcial no debe acertar con la carpeta de otra tarea.
    const id = folderId(taskId);
    const folder = fs
      .readdirSync(base)
      .filter((name) => /^\d{8}-\d{6}_/.test(name) && name.slice(STAMP_CHARS) === id)
      .sort()
      .pop();
    return folder === undefined ? null : fs.readFileSync(path.join(base, folder, TRACE_FILES[which]), "utf-8");
  } catch {
    return null;
  }
}
