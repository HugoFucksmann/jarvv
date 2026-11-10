/**
 * JARVIS Core — Retención de lo que Jarvis guarda en disco.
 *
 * Dos carpetas crecen con el uso: los resultados crudos de las refs (`refsDir/<tarea>/`) y las trazas (`<base>/<fecha>_<tarea>/`).
 * Esta política es una sola: por antigüedad (`retentionDays`). Se borran las subcarpetas cuya última modificación es anterior al
 * límite; nunca archivos sueltos (por ejemplo `index.jsonl` de las trazas) ni nada fuera de esas dos carpetas. Las refs de una tarea
 * que sigue retenida en memoria no se tocan: la API las sirve (`GET /tasks/:id/refs/:refId`) y una tarea puede esperar días una respuesta.
 *
 * Solo se borran carpetas con el NOMBRE que Jarvis les da (`REFS_FOLDER`, `TRACE_FOLDER`): `refsDir` y `tracePath` son configurables y, si
 * apuntaran a una carpeta del usuario, la retención no debe tocar lo que no creó. `index.jsonl` pierde las líneas de las carpetas borradas.
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

/** Carpeta de refs de una tarea: su id (`task_<ms>_<sufijo>`, ver `newId`). */
export const REFS_FOLDER = /^task_\d+_[A-Za-z0-9]+$/;

/** Carpeta de traza: `AAAAMMDD-HHMMSS_<id de la tarea>` (ver `folderName`). */
export const TRACE_FOLDER = /^\d{8}-\d{6}_task_\d+_[A-Za-z0-9]+$/;

/** Cada cuánto se repite la limpieza mientras el servidor sigue encendido. */
export const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Borra las subcarpetas directas de `dir` cuyo nombre cumple `owned`, modificadas antes de `now - maxAgeMs` y que `keep` no protege.
 * Devuelve los nombres borrados. Una carpeta inexistente no es un error. Los archivos sueltos, los enlaces simbólicos y las carpetas con
 * otro nombre no se tocan.
 */
export async function pruneFolders(
  dir: string,
  owned: RegExp,
  maxAgeMs: number,
  now: number,
  keep: (name: string) => boolean = () => false,
): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (!owned.test(name) || keep(name)) continue;
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

/** Quita de `index.jsonl` las líneas de las carpetas de traza que ya no existen; las líneas que no se pueden leer se conservan. */
export async function pruneTraceIndex(base: string): Promise<void> {
  const file = path.join(base, "index.jsonl");
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return;
  }
  let existing: Set<string>;
  try {
    existing = new Set(await fs.readdir(base));
  } catch {
    return;
  }
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const kept = lines.filter((line) => {
    try {
      const entry = JSON.parse(line) as { folder?: unknown };
      return typeof entry.folder !== "string" || existing.has(entry.folder);
    } catch {
      return true;
    }
  });
  if (kept.length === lines.length) return;
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, kept.length === 0 ? "" : `${kept.join("\n")}\n`, "utf8");
  await fs.rename(tmp, file);
}

/** Una pasada sobre las refs y las trazas, con la configuración vigente. `protectedTaskIds`: tareas cuyas refs no se borran. */
export async function runRetention(getConfig: ConfigSource, protectedTaskIds: () => readonly string[], now: number = Date.now()): Promise<void> {
  const config = getConfig();
  if (config.retentionDays <= 0) return;
  const maxAgeMs = config.retentionDays * DAY_MS;

  const kept = new Set(protectedTaskIds().map(taskFolderName));
  const refs = await pruneFolders(path.resolve(config.refsDir), REFS_FOLDER, maxAgeMs, now, (name) => kept.has(name));
  const traceBase = traceBaseDir(config.tracePath);
  const traces = await pruneFolders(traceBase, TRACE_FOLDER, maxAgeMs, now);
  if (traces.length > 0) await pruneTraceIndex(traceBase).catch((error: unknown) => console.warn(`[Retention] no se pudo limpiar index.jsonl: ${errorMessage(error)}`));
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
