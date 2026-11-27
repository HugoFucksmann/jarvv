/**
 * JARVIS Core — Recorrido de carpetas compartido por `find_files` y `search_content`.
 *
 * Recorre en anchura (BFS) y entrega cada entrada con su tipo ya resuelto. Quien lo usa decide qué hacer con ella; el recorrido solo se ocupa de lo que es común y delicado:
 * - Cancelación (`AbortSignal`), plazo (`deadline`) y tope de entradas (`maxEntries`): el recorrido termina y lo dice en `state` (`cancelled`, `stoppedBy`).
 * - Profundidad máxima (`maxDepth`): lo que quedó sin visitar se marca en `state.hitDepthLimit`.
 * - Enlaces simbólicos y uniones: no se sigue ninguno que salga de `realRoot` (se cuenta en `skipped`) y una carpeta enlazada se visita una sola vez.
 * - Lo ilegible se omite sin fallar (`skipped`); las carpetas ruidosas (`node_modules`, `.git`, la papelera…) no se entregan ni se recorren.
 * - Cede el turno al bucle de eventos cada `YIELD_EVERY_ENTRIES` entradas para no bloquearlo.
 *
 * `state` se actualiza mientras el generador avanza: se lee al terminar (o al cortar) el recorrido.
 */

import fs from "node:fs";
import {
  isCanonicalDescendant,
  isExcludedSubdir,
  joinEntryPath,
  raceAbort,
  yieldEventLoop,
} from "./filePaths.ts";

const YIELD_EVERY_ENTRIES = 64;

type WalkStop = "time" | "entries";

export interface WalkOptions {
  /** Carpeta de partida, tal como se muestra al usuario. */
  readonly root: string;
  /** La misma carpeta tras `realpath`: contra ella se comprueba que un enlace no escape. */
  readonly realRoot: string;
  /** Una carpeta a esta profundidad (la raíz es 0) no se recorre. */
  readonly maxDepth: number;
  /** Entradas que se revisan como máximo antes de cortar con `stoppedBy: "entries"`. */
  readonly maxEntries?: number;
  /** Instante (en la escala de `now`) a partir del cual se corta con `stoppedBy: "time"`. */
  readonly deadline: number;
  readonly now: () => number;
  readonly signal?: AbortSignal;
  /** `false` omite las entradas cuyo nombre empieza por `.` (se cuentan como revisadas). Por defecto se entregan. */
  readonly includeHidden?: boolean;
  /** `true` obtiene el tamaño de cada archivo (un `stat` por archivo; si falla, se omite y se cuenta en `skipped`). Por defecto solo se informa cuando sale gratis. */
  readonly statFiles?: boolean;
}

interface WalkState {
  /** Entradas revisadas (las que se omiten por nombre oculto también cuentan). */
  seen: number;
  /** Carpetas ilegibles y entradas que no se pudieron resolver o que salen de la raíz. */
  skipped: number;
  /** Había carpetas bajo `maxDepth` que no se recorrieron. */
  hitDepthLimit: boolean;
  stoppedBy: WalkStop | undefined;
  cancelled: boolean;
}

export interface WalkEntry {
  readonly path: string;
  readonly name: string;
  /** Profundidad de la entrada: 1 para lo que está dentro de la raíz. */
  readonly depth: number;
  readonly isDir: boolean;
  readonly isFile: boolean;
  /** Tamaño en bytes (0 en carpetas); `undefined` si no se pidió ni salió gratis (ver `statFiles`). */
  readonly size: number | undefined;
  /** Ruta tras `realpath` en un enlace; la propia ruta en el resto. */
  readonly realPath: string;
}

type Settled<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "failed" }
  | { readonly status: "aborted" };

/** Una operación de disco como resultado: ok, falló (el motivo no importa a quien recorre) o la cancelación llegó antes. */
export async function settle<T>(operation: Promise<T>, signal?: AbortSignal): Promise<Settled<T>> {
  const raced = await raceAbort(
    operation.then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    ),
    signal,
  );
  if (raced.aborted) return { status: "aborted" };
  return raced.value.ok ? { status: "ok", value: raced.value.value } : { status: "failed" };
}

type Classified =
  | { readonly kind: "entry"; readonly isDir: boolean; readonly isFile: boolean; readonly size: number | undefined; readonly realPath: string | undefined }
  | { readonly kind: "ignored" }
  | { readonly kind: "skipped" }
  | { readonly kind: "aborted" };

const IGNORED: Classified = { kind: "ignored" };
const SKIPPED: Classified = { kind: "skipped" };
const ABORTED: Classified = { kind: "aborted" };

/** Tipo y tamaño de una entrada del listado de su carpeta. */
async function classify(entry: fs.Dirent, fullPath: string, options: WalkOptions): Promise<Classified> {
  const { signal } = options;

  if (entry.isSymbolicLink()) {
    const real = await settle(fs.promises.realpath(fullPath), signal);
    if (real.status === "aborted") return ABORTED;
    if (real.status === "failed" || !isCanonicalDescendant(options.realRoot, real.value)) return SKIPPED;
    const target = await settle(fs.promises.stat(real.value), signal);
    if (target.status === "aborted") return ABORTED;
    if (target.status === "failed") return SKIPPED;
    const isDir = target.value.isDirectory();
    if (isDir && isExcludedSubdir(entry.name, fullPath)) return IGNORED;
    return { kind: "entry", isDir, isFile: target.value.isFile(), size: isDir ? 0 : target.value.size, realPath: real.value };
  }

  let isDir = entry.isDirectory();
  let isFile = entry.isFile();
  if (isDir && isExcludedSubdir(entry.name, fullPath)) return IGNORED;

  // Entrada sin tipo en el listado o de tipo especial (socket, FIFO…): el tipo real sale de `lstat`.
  if (!isDir && !isFile) {
    const info = await settle(fs.promises.lstat(fullPath), signal);
    if (info.status === "aborted") return ABORTED;
    if (info.status === "failed") return SKIPPED;
    isDir = info.value.isDirectory();
    isFile = info.value.isFile();
    if ((isDir && isExcludedSubdir(entry.name, fullPath)) || (!isDir && !isFile)) return IGNORED;
    return { kind: "entry", isDir, isFile, size: isDir ? 0 : info.value.size, realPath: undefined };
  }

  if (isFile && options.statFiles === true) {
    const info = await settle(fs.promises.stat(fullPath), signal);
    if (info.status === "aborted") return ABORTED;
    if (info.status === "failed") return SKIPPED;
    return { kind: "entry", isDir, isFile, size: info.value.size, realPath: undefined };
  }

  return { kind: "entry", isDir, isFile, size: isDir ? 0 : undefined, realPath: undefined };
}

/** Recorre `options.root` en anchura. `state` se llena mientras se consume `entries`. */
export function walkFolder(options: WalkOptions): { readonly entries: AsyncGenerator<WalkEntry, void, undefined>; readonly state: WalkState } {
  const state: WalkState = { seen: 0, skipped: 0, hitDepthLimit: false, stoppedBy: undefined, cancelled: false };
  const { signal, now, deadline } = options;

  /** ¿Hay que cortar ya? Deja el motivo en `state`. */
  const interrupted = (): boolean => {
    if (signal?.aborted) {
      state.cancelled = true;
      return true;
    }
    if (now() >= deadline) {
      state.stoppedBy = "time";
      return true;
    }
    return false;
  };

  async function* run(): AsyncGenerator<WalkEntry, void, undefined> {
    const visitedDirs = new Set<string>([options.realRoot]);
    const queue: Array<{ readonly dirPath: string; readonly depth: number }> = [{ dirPath: options.root, depth: 0 }];

    for (let next = 0; next < queue.length; next++) {
      if (interrupted()) return;
      const current = queue[next];

      const listing = await settle(fs.promises.readdir(current.dirPath, { withFileTypes: true }), signal);
      if (listing.status === "aborted") {
        state.cancelled = true;
        return;
      }
      if (listing.status === "failed") {
        state.skipped++;
        continue;
      }

      for (const entry of listing.value) {
        if (interrupted()) return;
        if (options.maxEntries !== undefined && state.seen >= options.maxEntries) {
          state.stoppedBy = "entries";
          return;
        }

        state.seen++;
        if (state.seen % YIELD_EVERY_ENTRIES === 0) {
          await yieldEventLoop();
          if (interrupted()) return;
        }
        if (options.includeHidden === false && entry.name.startsWith(".")) continue;

        const fullPath = joinEntryPath(current.dirPath, entry.name);
        const classified = await classify(entry, fullPath, options);
        if (classified.kind === "aborted") {
          state.cancelled = true;
          return;
        }
        if (classified.kind === "skipped") {
          state.skipped++;
          continue;
        }
        if (classified.kind === "ignored") continue;

        const depth = current.depth + 1;
        yield { path: fullPath, name: entry.name, depth, isDir: classified.isDir, isFile: classified.isFile, size: classified.size, realPath: classified.realPath ?? fullPath };

        if (!classified.isDir) continue;
        if (depth >= options.maxDepth) {
          state.hitDepthLimit = true;
        } else {
          // Cada carpeta se visita una vez aunque un enlace interno apunte a ella: se registra por su ruta real (la propia ruta, si no es un enlace).
          const key = classified.realPath ?? fullPath;
          if (!visitedDirs.has(key)) {
            visitedDirs.add(key);
            queue.push({ dirPath: fullPath, depth });
          }
        }
      }
    }
  }

  return { entries: run(), state };
}
