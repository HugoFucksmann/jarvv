/**
 * JARVIS Core — Retención de lo que Jarvis guarda en disco.
 *
 * Dos carpetas crecen con el uso: los resultados crudos de las refs (`refsDir/<tarea>/`) y las trazas (`<base>/<fecha>_<tarea>/`).
 * Esta política es una sola: por antigüedad (`retentionDays`). Se borran las subcarpetas cuya última modificación es anterior al
 * límite; nunca archivos sueltos (por ejemplo `index.jsonl` de las trazas) ni nada fuera de esas dos carpetas. Las refs de una tarea
 * que sigue retenida en memoria no se tocan: la API las sirve (`GET /tasks/:id/refs/:refId`) y una tarea puede esperar días una respuesta.
 *
 * El borrado nunca interrumpe nada: un fallo se informa y se sigue.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { ConfigSource } from "./config.ts";
import { taskFolderName } from "./refs/refVault.ts";
import { traceBaseDir } from "./trace/files.ts";
import { errorMessage } from "./utils.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cada cuánto se repite la limpieza mientras el servidor sigue encendido. */
export const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Borra las subcarpetas directas de `dir` modificadas antes de `now - maxAgeMs` y que `keep` no protege. Devuelve los nombres borrados.
 * Una carpeta inexistente no es un error. Los archivos sueltos y los enlaces simbólicos no se tocan.
 */
export async function pruneFolders(dir: string, maxAgeMs: number, now: number, keep: (name: string) => boolean = () => false): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (keep(name)) continue;
    const full = path.join(dir, name);
    try {
      const info = await fs.lstat(full);
      if (!info.isDirectory() || now - info.mtimeMs <= maxAgeMs) continue;
      await fs.rm(full, { recursive: true, force: true });
      removed.push(name);
    } catch (error) {
      console.warn(`[Retention] no se pudo borrar '${full}': ${errorMessage(error)}`);
    }
  }
  return removed;
}

/** Una pasada sobre las refs y las trazas, con la configuración vigente. `protectedTaskIds`: tareas cuyas refs no se borran. */
export async function runRetention(getConfig: ConfigSource, protectedTaskIds: () => readonly string[], now: number = Date.now()): Promise<void> {
  const config = getConfig();
  if (config.retentionDays <= 0) return;
  const maxAgeMs = config.retentionDays * DAY_MS;

  const kept = new Set(protectedTaskIds().map(taskFolderName));
  const refs = await pruneFolders(path.resolve(config.refsDir), maxAgeMs, now, (name) => kept.has(name));
  const traces = await pruneFolders(traceBaseDir(config.tracePath), maxAgeMs, now);
  if (refs.length + traces.length > 0) {
    console.log(`[Retention] se borraron ${refs.length} carpeta(s) de refs y ${traces.length} de trazas con más de ${config.retentionDays} días.`);
  }
}

/** Corre la limpieza ahora y cada `RETENTION_INTERVAL_MS`. Devuelve la función que la detiene. El temporizador no mantiene vivo el proceso. */
export function startRetention(getConfig: ConfigSource, protectedTaskIds: () => readonly string[]): () => void {
  const run = (): void => {
    runRetention(getConfig, protectedTaskIds).catch((error: unknown) => console.warn(`[Retention] falló la limpieza: ${errorMessage(error)}`));
  };
  run();
  const timer = setInterval(run, RETENTION_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
