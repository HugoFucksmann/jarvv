/**
 * `jarvis_files_write`: herramienta `move_file` (mover y renombrar en lote).
 *
 * Acepta `items: Array<{ source, destination }>` (hasta 200 elementos por llamada):
 * - Valida `allowedDirectories` en cada origen y destino.
 * - Impide mover raíces del sistema o carpetas raíz del usuario (`home`, `desktop`, etc.),
 *   mover a la misma ruta o mover una carpeta dentro de sí misma.
 * - Usa `fs.promises.rename` cuando están en el mismo volumen y cae en copia controlada +
 *   borrado del origen cuando el sistema responde `EXDEV`.
 */

import fs from "node:fs";
import type { UserEnvironment } from "../../core/environment.ts";
import { canonicalPath } from "../../core/policy/allowedDirs.ts";
import {
  dirnameOf,
  effectiveTimeoutMs,
  inspectDestinationTarget,
  isCanonicalDescendant,
  isProtectedUserOrSystemRoot,
  resolveExistingPath,
  resolvePathTarget,
  type ResolvedExistingTarget,
  type ResolvedTarget,
  tempSuffix,
} from "../../core/tools/filePaths.ts";
import { toolResult, toolFail as fail } from "../../core/tools/result.ts";
import type { MCPCallResult } from "../../core/types.ts";
import { errorMessage, isRecord } from "../../core/utils.ts";
import {
  copyPathControlled,
  DEFAULT_COPY_MAX_BYTES,
  DEFAULT_COPY_MAX_ENTRIES,
  DEFAULT_COPY_TIMEOUT_MS,
} from "./copyFile.ts";

export const MAX_MOVE_ITEMS = 200;

interface MoveFileDeps {
  readonly getAllowedDirectories: () => readonly string[];
  readonly getEnvironment: () => Promise<UserEnvironment>;
  readonly now: () => number;
  readonly defaultTimeoutMs?: number;
  /** Topes de la copia que reemplaza al `rename` cuando origen y destino están en volúmenes distintos (los mismos que `copy_file`). */
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

interface MoveItemArg {
  readonly source: string;
  readonly destination: string;
}

interface MoveItemOutcome {
  readonly source: string;
  readonly destination: string;
  readonly status: "moved" | "failed";
  readonly message?: string;
}

const cancelledResult = (moved: number): MCPCallResult =>
  toolResult({ text: "status: cancelled", raw: "", data: { state: "cancelled", moved, truncated: false } });

function parseArgs(
  raw: Record<string, unknown>,
):
  | { readonly ok: true; readonly items: readonly MoveItemArg[]; readonly overwrite: boolean }
  | { readonly ok: false; readonly message: string } {
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    return { ok: false, message: "'items' is required and must be a non-empty array of { source, destination }." };
  }
  if (raw.items.length > MAX_MOVE_ITEMS) {
    return { ok: false, message: `'items' supports at most ${MAX_MOVE_ITEMS} entries per call.` };
  }

  const items: MoveItemArg[] = [];
  for (let i = 0; i < raw.items.length; i++) {
    const item = raw.items[i];
    if (!isRecord(item) || typeof item.source !== "string" || item.source.trim() === "" || typeof item.destination !== "string" || item.destination.trim() === "") {
      return { ok: false, message: `items[${i}] must have non-empty string 'source' and 'destination'.` };
    }
    items.push({ source: item.source.trim(), destination: item.destination.trim() });
  }

  let overwrite = false;
  if (raw.overwrite !== undefined && raw.overwrite !== null) {
    if (typeof raw.overwrite !== "boolean") return { ok: false, message: "'overwrite' must be true or false." };
    overwrite = raw.overwrite;
  }

  return { ok: true, items, overwrite };
}

const failedMove = (source: string, destination: string, message: string): MoveItemOutcome => ({ source, destination, status: "failed", message });
const movedItem = (source: string, destination: string): MoveItemOutcome => ({ source, destination, status: "moved" });

type ExistingSource = Extract<ResolvedExistingTarget, { readonly ok: true }>;
type ResolvedDestination = Extract<ResolvedTarget, { readonly ok: true }>;
type DestinationState = Exclude<Awaited<ReturnType<typeof inspectDestinationTarget>>, { readonly status: "denied" | "error" }>;

/** Lo que ya se comprobó de un movimiento: origen y destino resueltos, y el estado actual del destino. */
interface MovePlan {
  readonly src: ExistingSource;
  readonly dst: ResolvedDestination;
  readonly destination: DestinationState;
}

/**
 * Las comprobaciones previas de un movimiento, en orden: origen existente y no protegido, destino válido, no mover algo a sí mismo ni una carpeta dentro de sí,
 * carpeta padre del destino y qué hay ya en el destino. Si algo falla, el resultado del ítem ya viene armado.
 */
async function planMove(
  item: MoveItemArg,
  overwrite: boolean,
  deps: MoveFileDeps,
  allowedDirs: readonly string[],
): Promise<{ readonly ok: true; readonly plan: MovePlan } | { readonly ok: false; readonly outcome: MoveItemOutcome }> {
  const refuse = (source: string, destination: string, message: string) => ({ ok: false as const, outcome: failedMove(source, destination, message) });

  const src = await resolveExistingPath(item.source, deps.getEnvironment, allowedDirs, {
    expectedKind: "any",
    followSymlinkForAllowedCheck: false,
    paramName: "source",
  });
  if (!src.ok) return refuse(item.source, item.destination, src.message);

  if (isProtectedUserOrSystemRoot(src.targetPath, src.env)) {
    return refuse(src.targetPath, item.destination, `[DENIED] Refusing to move protected root folder '${src.targetPath}'.`);
  }

  const dst = await resolvePathTarget(item.destination, deps.getEnvironment, allowedDirs, {
    allowEmptyAsHome: false,
    paramName: "destination",
  });
  if (!dst.ok) return refuse(src.targetPath, item.destination, dst.message);
  const refuseHere = (message: string) => refuse(src.targetPath, dst.targetPath, message);

  const canonicalSrc = canonicalPath(src.targetPath);
  const canonicalDst = canonicalPath(dst.targetPath);
  if (isCanonicalDescendant(canonicalSrc, canonicalDst) && isCanonicalDescendant(canonicalDst, canonicalSrc)) {
    return refuseHere("Source and destination refer to the same path.");
  }
  if (src.isDirectory && isCanonicalDescendant(src.realTarget, canonicalDst)) {
    return refuseHere(`Cannot move folder '${src.targetPath}' into itself or its subfolder.`);
  }

  const parentDir = dirnameOf(dst.targetPath);
  try {
    const parentStat = await fs.promises.stat(parentDir);
    if (!parentStat.isDirectory()) return refuseHere(`Destination parent '${parentDir}' is not a folder.`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return refuseHere(code === "ENOENT" ? `Destination parent folder does not exist: '${parentDir}'.` : errorMessage(error));
  }

  const destination = await inspectDestinationTarget(dst.targetPath, allowedDirs, dst.env.home);
  if (destination.status === "denied" || destination.status === "error") return refuseHere(destination.message);
  if (destination.status === "exists") {
    if (!overwrite) return refuseHere(`Destination already exists: '${dst.targetPath}'. Pass overwrite: true to replace.`);
    if (destination.isDirectory !== src.isDirectory) {
      return refuseHere(`Cannot overwrite ${destination.isDirectory ? "folder" : "file"} with a ${src.isDirectory ? "folder" : "file"}.`);
    }
  }

  return { ok: true, plan: { src, dst, destination } };
}

/** Mueve con `rename`; entre volúmenes distintos (`EXDEV`) copia de forma controlada y borra el origen. */
async function renameOrCopy(
  { src, dst }: MovePlan,
  overwrite: boolean,
  deps: MoveFileDeps,
  allowedDirs: readonly string[],
  deadline: number,
  signal?: AbortSignal,
): Promise<MoveItemOutcome> {
  try {
    await fs.promises.rename(src.targetPath, dst.targetPath);
    return movedItem(src.targetPath, dst.targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") return failedMove(src.targetPath, dst.targetPath, errorMessage(error));
  }

  if (src.isSymlink) {
    const linkTarget = await fs.promises.readlink(src.targetPath);
    // El enlace nuevo se crea aparte y reemplaza al destino con un `rename`: si algo falla antes, lo que había en el destino queda como estaba.
    const staging = `${dst.targetPath}.jarvis-ln-${tempSuffix()}`;
    try {
      await fs.promises.symlink(linkTarget, staging);
      await fs.promises.rename(staging, dst.targetPath);
    } catch (error) {
      await fs.promises.rm(staging, { force: true }).catch(() => {});
      throw error;
    }
    await fs.promises.unlink(src.targetPath);
    return movedItem(src.targetPath, dst.targetPath);
  }

  const copied = await copyPathControlled({
    sourcePath: src.targetPath,
    realSource: src.realTarget,
    isSourceDir: src.isDirectory,
    destinationPath: dst.targetPath,
    overwrite,
    allowedDirs,
    home: dst.env.home,
    now: deps.now,
    deadline,
    maxEntries: deps.maxEntries ?? DEFAULT_COPY_MAX_ENTRIES,
    maxBytes: deps.maxBytes ?? DEFAULT_COPY_MAX_BYTES,
    signal,
  });
  if (!copied.ok) return failedMove(src.targetPath, dst.targetPath, copied.message);
  await fs.promises.rm(src.targetPath, { recursive: src.isDirectory, force: false });
  return movedItem(src.targetPath, dst.targetPath);
}

/**
 * Al sobrescribir una carpeta real no se borra el destino por adelantado: se aparta como respaldo y solo se elimina cuando el movimiento termina bien
 * (si falla, se restaura).
 */
class OverwriteBackup {
  private backupPath: string | null = null;

  constructor(private readonly targetPath: string) {}

  /** Aparta el destino actual (también un enlace simbólico: se renombra el enlace, no su destino), para poder restaurarlo si el movimiento falla. */
  async setAside(): Promise<void> {
    this.backupPath = `${this.targetPath}.jarvis-bak-${tempSuffix()}`;
    await fs.promises.rename(this.targetPath, this.backupPath);
  }

  private async restore(): Promise<void> {
    if (this.backupPath === null) return;
    try {
      await fs.promises.rm(this.targetPath, { recursive: true, force: true });
      await fs.promises.rename(this.backupPath, this.targetPath);
      this.backupPath = null;
    } catch {
      /* no se pudo restaurar: el respaldo queda en disco y se informa en el resultado */
    }
  }

  /** Cierra el movimiento: con éxito se descarta el respaldo; con fallo se restaura y, si no se pudo, se dice dónde quedó. */
  async settle(result: MoveItemOutcome): Promise<MoveItemOutcome> {
    if (this.backupPath === null) return result;
    if (result.status === "moved") {
      try {
        await fs.promises.rm(this.backupPath, { recursive: true, force: true });
      } catch {
        return { ...result, message: `Moved, but the previous destination backup could not be removed: '${this.backupPath}'.` };
      }
      return result;
    }
    await this.restore();
    if (this.backupPath !== null) {
      return { ...result, message: `${result.message ?? "failed"} (the previous destination was kept at '${this.backupPath}')` };
    }
    return result;
  }
}

async function moveSingleItem(
  item: MoveItemArg,
  overwrite: boolean,
  deps: MoveFileDeps,
  deadline: number,
  signal?: AbortSignal,
): Promise<MoveItemOutcome> {
  const allowedDirs = deps.getAllowedDirectories();
  const planned = await planMove(item, overwrite, deps, allowedDirs);
  if (!planned.ok) return planned.outcome;
  const { plan } = planned;
  const { src, dst, destination } = plan;

  if (signal?.aborted) return failedMove(src.targetPath, dst.targetPath, "cancelled");

  const backup = new OverwriteBackup(dst.targetPath);
  try {
    if (destination.status === "exists" && overwrite && src.isDirectory) await backup.setAside();
    return await backup.settle(await renameOrCopy(plan, overwrite, deps, allowedDirs, deadline, signal));
  } catch (error) {
    return backup.settle(failedMove(src.targetPath, dst.targetPath, errorMessage(error)));
  }
}

export async function runMoveFile(
  rawArgs: Record<string, unknown>,
  deps: MoveFileDeps,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<MCPCallResult> {
  if (options.signal?.aborted) return cancelledResult(0);

  const parsed = parseArgs(rawArgs);
  if (!parsed.ok) return fail(parsed.message);

  const timeoutMs = deps.defaultTimeoutMs ?? DEFAULT_COPY_TIMEOUT_MS;
  const limitMs = effectiveTimeoutMs(timeoutMs, options.timeoutMs);
  const deadline = deps.now() + limitMs;

  const outcomes: MoveItemOutcome[] = [];
  let moved = 0;

  for (const item of parsed.items) {
    if (options.signal?.aborted) return cancelledResult(moved);
    const outcome = await moveSingleItem(item, parsed.overwrite, deps, deadline, options.signal);
    if (options.signal?.aborted) return cancelledResult(moved);
    outcomes.push(outcome);
    if (outcome.status === "moved") moved++;
  }

  const failed = outcomes.length - moved;
  const lines = outcomes.map((o) =>
    o.status === "moved"
      ? `[MOVED]  ${o.source} -> ${o.destination}`
      : `[FAILED] ${o.source} -> ${o.destination}: ${o.message ?? "unknown error"}`,
  );
  const header = `status: ${failed === 0 ? "ok" : moved > 0 ? "partial" : "error"} · moved ${moved} of ${outcomes.length} item(s)`;
  const text = [header, ...lines].join("\n");

  return toolResult({
    text,
    raw: text,
    isError: moved === 0 && failed > 0,
    data: {
      state: failed === 0 ? "ok" : moved > 0 ? "partial" : "error",
      moved,
      failed,
      total: outcomes.length,
      items: outcomes,
      truncated: false,
    },
  });
}
