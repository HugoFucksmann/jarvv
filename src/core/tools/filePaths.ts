/**
 * JARVIS Core — Utilidades compartidas de rutas, alias del usuario, `allowedDirectories`,
 * prevención de escapes por enlaces simbólicos, cancelación y formato para proveedores nativos.
 *
 * Vive en `src/core/tools/` para que los distintos grupos (`files`, `files_read`, `files_write`,
 * `system`, `web`) puedan compartirlo sin importarse entre sí (`tests/architecture.test.ts`).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { UserEnvironment } from "../environment.ts";
import {
  canonicalPath,
  checkAllowedDirectory,
  expandHome,
  isAnyAbsolute,
  isPathInsideCanonical,
  isWinPath,
  stripExtendedPrefix,
} from "../policy/allowedDirs.ts";
import { isPathArgKey, PATH_LIST_KEY } from "../policy/pathArgs.ts";
import { errorMessage } from "../utils.ts";

export const KNOWN_ALIASES = ["home", "desktop", "documents", "downloads"] as const;
type KnownAlias = (typeof KNOWN_ALIASES)[number];

/**
 * Carpetas excluidas por defecto durante recorridos descendentes de búsqueda/copia:
 * - `node_modules`, `.git`: árboles enormes de dependencias e historial.
 * - `$recycle.bin`, `recycler`, `.trash`: papelera del sistema.
 * - `system volume information`: metadatos protegidos de volúmenes NTFS.
 * - `windows/winsxs`: almacén de componentes de Windows.
 */
const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "$recycle.bin",
  "recycler",
  ".trash",
  "system volume information",
]);

export function isExcludedSubdir(dirName: string, fullPath: string): boolean {
  if (EXCLUDED_DIR_NAMES.has(dirName.toLowerCase())) return true;
  const normalized = fullPath.replace(/\\/g, "/").toLowerCase();
  return normalized.endsWith("/windows/winsxs");
}

type ResolvedFolder =
  | { readonly ok: true; readonly targetPath: string; readonly realRoot: string }
  | { readonly ok: false; readonly denied: boolean; readonly message: string };

export type ResolvedTarget =
  | { readonly ok: true; readonly targetPath: string; readonly env: UserEnvironment }
  | { readonly ok: false; readonly denied: boolean; readonly message: string };

export type ResolvedExistingTarget =
  | {
      readonly ok: true;
      readonly targetPath: string;
      readonly realTarget: string;
      readonly isFile: boolean;
      readonly isDirectory: boolean;
      readonly isSymlink: boolean;
      readonly size: number;
      readonly mtimeMs: number;
      readonly env: UserEnvironment;
    }
  | { readonly ok: false; readonly denied: boolean; readonly notFound?: boolean; readonly message: string };

/** Datos de error de una ruta que no se pudo resolver: el motivo (`denied`, `not_found`) para quien lee el resultado. Una ruta que falla por otra causa no lleva motivo. */
export function pathFailureData(failure: { readonly denied: boolean; readonly notFound?: boolean }): Record<string, unknown> {
  if (failure.denied) return { reason: "denied" };
  return failure.notFound === true ? { reason: "not_found" } : {};
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

function formatDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** Tamaño legible para el modelo (`12 KB`, `12.4 KB`, `3.2 MB`). */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < KB) return `${Math.round(bytes)} B`;
  if (bytes < MB) return `${formatDecimal(bytes / KB)} KB`;
  if (bytes < GB) return `${formatDecimal(bytes / MB)} MB`;
  return `${formatDecimal(bytes / GB)} GB`;
}

/** Fecha y hora local compacta (`YYYY-MM-DD HH:MM`). */
export function formatLocalDateTime(ms: number): string {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/** Une un segmento usando el separador propio de la ruta (Windows o POSIX). */
export function joinEntryPath(dir: string, name: string): string {
  return isWinPath(dir) ? path.win32.join(dir, name) : path.join(dir, name);
}

/** Obtiene el directorio padre respetando rutas Windows y POSIX. */
export function dirnameOf(targetPath: string): string {
  return isWinPath(targetPath) ? path.win32.dirname(targetPath) : path.posix.dirname(targetPath);
}

/** Normaliza una ruta absoluta (Windows o POSIX) quitando prefijos extendidos. */
function normalizeAbsolutePath(candidate: string): string {
  const clean = stripExtendedPrefix(candidate);
  return isWinPath(clean) ? path.win32.normalize(clean.replace(/\//g, "\\")) : path.resolve(clean);
}

/**
 * Comprueba si `realTarget` coincide con `realRoot` o está dentro de él, sin volver al disco
 * (ambas rutas ya pasaron por `realpath`). Maneja rutas de Windows y POSIX.
 */
export function isCanonicalDescendant(realRoot: string, realTarget: string): boolean {
  const root = stripExtendedPrefix(realRoot);
  const target = stripExtendedPrefix(realTarget);
  if (!root || !target) return false;
  if (isWinPath(root) || isWinPath(target)) {
    if (!isWinPath(root) || !isWinPath(target)) return false;
    const rel = path.win32.relative(root.toLowerCase(), target.toLowerCase());
    return rel === "" || (rel !== ".." && !rel.startsWith("..\\") && !path.win32.isAbsolute(rel));
  }
  const rel = path.posix.relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !path.posix.isAbsolute(rel));
}

/** `alias` solo, o `alias` seguido de una subruta con `\` o `/` (`desktop\Archivos\Docs`). El alias no distingue mayúsculas. */
const ALIAS_PATH = /^(home|desktop|documents|downloads)(?:[\\/]+(.*))?$/i;

/**
 * Resuelve un alias de carpeta del usuario, solo (`desktop`) o con una subruta (`desktop\Archivos`). La subruta se une a la carpeta real del alias con las reglas de la plataforma del
 * usuario (la carpeta puede estar redirigida, p. ej. OneDrive, y no es `home\Desktop`). Un `..` se normaliza al unir; los controles de `allowedDirectories` y del Guard se aplican después
 * sobre la ruta ya resuelta.
 */
export function resolveAlias(
  raw: string,
  env: UserEnvironment,
): { readonly found: true; readonly path: string } | { readonly found: false; readonly missingAlias?: KnownAlias } {
  const match = ALIAS_PATH.exec(raw.trim());
  if (match === null) return { found: false };
  const alias = match[1].toLowerCase() as KnownAlias;
  const root = env[alias];
  if (!root) return { found: false, missingAlias: alias };
  const rest = (match[2] ?? "").trim();
  if (rest === "") return { found: true, path: root };
  return { found: true, path: (env.platform === "windows" ? path.win32 : path.posix).join(root, rest) };
}

/** `raw` con el alias (solo o con subruta) reemplazado por la ruta real; el mismo texto si no es un alias o la carpeta no existe en este entorno. */
export function expandAliasPath(raw: string, env: UserEnvironment): string {
  const resolved = resolveAlias(raw, env);
  return resolved.found ? resolved.path : raw;
}

/**
 * Los argumentos de una herramienta con cada ruta que empieza por un alias ya expandida (`path`, `source`, `destination`…, las listas `paths` y `sources` y los pares de `items`; las
 * claves son las de `policy/pathArgs.ts`). Se hace UNA vez, al preparar la llamada, y desde ahí el Guard, el pre-chequeo, `allowedDirectories`, la aprobación y la herramienta ven la misma
 * ruta absoluta: sin esto el Guard resolvía `desktop\x` contra la carpeta del proyecto (protegida) y la herramienta lo rechazaba por no ser absoluta.
 */
export function expandPathAliases(args: Readonly<Record<string, unknown>>, env: UserEnvironment): Record<string, unknown> {
  const expand = (value: unknown): unknown => (typeof value === "string" ? expandAliasPath(value, env) : value);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const k = key.toLowerCase();
    if (isPathArgKey(k)) out[key] = expand(value);
    else if ((k === PATH_LIST_KEY || k === "sources") && Array.isArray(value)) out[key] = value.map(expand);
    else if (k === "items" && Array.isArray(value)) {
      out[key] = value.map((item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(Object.entries(item).map(([ik, iv]) => [ik, isPathArgKey(ik) ? expand(iv) : iv]))
          : item,
      );
    } else out[key] = value;
  }
  return out;
}

/** Indica si `targetPath` coincide exactamente con una raíz del sistema o carpeta raíz del usuario (`home`, `desktop`, etc.). */
export function isProtectedUserOrSystemRoot(targetPath: string, env: UserEnvironment): boolean {
  const clean = stripExtendedPrefix(targetPath);
  if (!clean) return true;
  if (/^[A-Za-z]:\\?$/.test(clean) || clean === "/" || /^\\\\[^\\]+\\[^\\]+\\?$/.test(clean)) {
    return true;
  }
  const roots = [env.home, env.desktop, env.documents, env.downloads].filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  const targetCanon = canonicalPath(clean);
  return roots.some((root) => {
    const rootCanon = canonicalPath(root);
    return isCanonicalDescendant(targetCanon, rootCanon) && isCanonicalDescendant(rootCanon, targetCanon);
  });
}

/**
 * Resuelve una ruta o alias (`home`, `desktop`, `documents`, `downloads`, `~/...`) sin exigir que exista todavía,
 * validando `allowedDirectories` (incluyendo ancestros con symlinks mediante `checkAllowedDirectory`).
 */
export async function resolvePathTarget(
  rawPath: string | undefined,
  getEnv: () => Promise<UserEnvironment>,
  allowedDirs: readonly string[],
  options: { readonly allowEmptyAsHome?: boolean; readonly paramName?: string } = {},
): Promise<ResolvedTarget> {
  const paramName = options.paramName ?? "path";
  let env: UserEnvironment;
  try {
    env = await getEnv();
  } catch (error) {
    return { ok: false, denied: false, message: `Could not read user environment: ${errorMessage(error)}` };
  }

  const trimmed = rawPath?.trim() ?? "";
  if (trimmed.includes("\0")) {
    return { ok: false, denied: false, message: `'${paramName}' contains invalid null bytes.` };
  }

  let candidate: string;
  if (trimmed === "") {
    if (!options.allowEmptyAsHome) {
      return { ok: false, denied: false, message: `'${paramName}' is required and must not be empty.` };
    }
    candidate = env.home;
  } else {
    const aliased = resolveAlias(trimmed, env);
    if (aliased.found) {
      candidate = aliased.path;
    } else if (aliased.missingAlias !== undefined) {
      return {
        ok: false,
        denied: false,
        message: `Known folder '${aliased.missingAlias}' is not available in this environment.`,
      };
    } else {
      candidate = expandHome(trimmed, env.home);
    }
  }

  const cleanCandidate = stripExtendedPrefix(candidate);
  if (!isAnyAbsolute(cleanCandidate)) {
    return {
      ok: false,
      denied: false,
      message: `'${paramName}' must be an absolute path or one of: ${KNOWN_ALIASES.join(", ")} (got '${trimmed}').`,
    };
  }

  const normalizedDirs = allowedDirs.map((d) => d.trim()).filter((d) => d !== "");
  if (normalizedDirs.length > 0) {
    const check = checkAllowedDirectory(candidate, normalizedDirs, { home: env.home });
    if (!check.allowed) {
      if (check.reason === "outside") {
        return {
          ok: false,
          denied: true,
          message: `[DENIED] Path '${cleanCandidate}' is outside allowedDirectories (${normalizedDirs.join(", ")}).`,
        };
      }
      return {
        ok: false,
        denied: false,
        message: `Path '${cleanCandidate}' could not be resolved.`,
      };
    }
  }

  return {
    ok: true,
    targetPath: normalizeAbsolutePath(cleanCandidate),
    env,
  };
}

/** Verifica si una ruta canónica ya resuelta permanece dentro de `allowedDirs` (cuando no está vacío). */
export function isCanonicalWithinAllowedDirs(
  canonicalTarget: string,
  allowedDirs: readonly string[],
  home: string,
): boolean {
  const normalizedDirs = allowedDirs.map((d) => d.trim()).filter((d) => d !== "");
  if (normalizedDirs.length === 0) return true;
  return normalizedDirs.some((dir) => isPathInsideCanonical(expandHome(dir, home), canonicalTarget));
}

/**
 * Resuelve la carpeta pedida (alias o ruta absoluta), valida `allowedDirectories` y verifica
 * que exista y sea un directorio accesible.
 */
export async function resolveFolderPath(
  rawPath: string | undefined,
  getEnv: () => Promise<UserEnvironment>,
  allowedDirs: readonly string[],
): Promise<ResolvedFolder> {
  const resolved = await resolvePathTarget(rawPath, getEnv, allowedDirs, { allowEmptyAsHome: true, paramName: "path" });
  if (!resolved.ok) return resolved;

  const { targetPath, env } = resolved;
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { ok: false, denied: false, message: `Folder does not exist: '${targetPath}'.` };
    }
    if (code === "EACCES" || code === "EPERM") {
      return { ok: false, denied: false, message: `Cannot access folder '${targetPath}': permission denied.` };
    }
    return { ok: false, denied: false, message: `Cannot access folder '${targetPath}': ${errorMessage(error)}` };
  }

  if (!stat.isDirectory()) {
    return { ok: false, denied: false, message: `'${targetPath}' is a file, not a folder.` };
  }

  let realRoot: string;
  try {
    realRoot = await fs.promises.realpath(targetPath);
  } catch (error) {
    return { ok: false, denied: false, message: `Cannot resolve folder '${targetPath}': ${errorMessage(error)}` };
  }

  if (!isCanonicalWithinAllowedDirs(realRoot, allowedDirs, env.home)) {
    return {
      ok: false,
      denied: true,
      message: `[DENIED] Folder '${targetPath}' resolves outside allowedDirectories.`,
    };
  }

  return { ok: true, targetPath, realRoot };
}

/**
 * Resuelve un archivo o carpeta existente validando `allowedDirectories`, enlaces simbólicos
 * y el tipo esperado (`file`, `directory`, `any`).
 */
export async function resolveExistingPath(
  rawPath: string | undefined,
  getEnv: () => Promise<UserEnvironment>,
  allowedDirs: readonly string[],
  options: {
    readonly expectedKind?: "any" | "file" | "directory";
    readonly followSymlinkForAllowedCheck?: boolean;
    readonly paramName?: string;
  } = {},
): Promise<ResolvedExistingTarget> {
  const expectedKind = options.expectedKind ?? "any";
  const followCheck = options.followSymlinkForAllowedCheck ?? true;
  const resolved = await resolvePathTarget(rawPath, getEnv, allowedDirs, {
    allowEmptyAsHome: false,
    paramName: options.paramName ?? "path",
  });
  if (!resolved.ok) return resolved;

  const { targetPath, env } = resolved;
  let lst: fs.Stats;
  try {
    lst = await fs.promises.lstat(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { ok: false, denied: false, notFound: true, message: `Path does not exist: '${targetPath}'.` };
    }
    if (code === "EACCES" || code === "EPERM") {
      return { ok: false, denied: false, message: `Cannot access '${targetPath}': permission denied.` };
    }
    return { ok: false, denied: false, message: `Cannot access '${targetPath}': ${errorMessage(error)}` };
  }

  const isSymlink = lst.isSymbolicLink();
  let st = lst;
  let realTarget = targetPath;
  if (isSymlink) {
    if (followCheck) {
      try {
        realTarget = await fs.promises.realpath(targetPath);
        st = await fs.promises.stat(realTarget);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          return { ok: false, denied: false, notFound: true, message: `Symbolic link target does not exist for '${targetPath}'.` };
        }
        return { ok: false, denied: false, message: `Cannot resolve symbolic link '${targetPath}': ${errorMessage(error)}` };
      }
      if (!isCanonicalWithinAllowedDirs(realTarget, allowedDirs, env.home)) {
        return {
          ok: false,
          denied: true,
          message: `[DENIED] Path '${targetPath}' points outside allowedDirectories.`,
        };
      }
    }
  } else {
    try {
      realTarget = await fs.promises.realpath(targetPath);
    } catch {
      realTarget = targetPath;
    }
  }

  const isDir = st.isDirectory();
  const isFile = st.isFile();

  if (expectedKind === "file" && isDir) {
    return { ok: false, denied: false, message: `'${targetPath}' is a folder, not a file.` };
  }
  if (expectedKind === "directory" && !isDir) {
    return { ok: false, denied: false, message: `'${targetPath}' is a file, not a folder.` };
  }
  if (expectedKind === "file" && !isFile && !isSymlink) {
    return { ok: false, denied: false, message: `'${targetPath}' is not a regular file.` };
  }

  return {
    ok: true,
    targetPath,
    realTarget,
    isFile,
    isDirectory: isDir,
    isSymlink,
    size: isDir ? 0 : st.size,
    mtimeMs: st.mtimeMs,
    env,
  };
}

type DestinationInspection =
  | { readonly status: "missing" }
  | {
      readonly status: "exists";
      readonly realTarget: string;
      readonly isDirectory: boolean;
      readonly isFile: boolean;
      readonly isSymlink: boolean;
    }
  | { readonly status: "denied"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

/**
 * Inspecciona una ruta de destino antes de escribir o sobrescribir:
 * - Separa `lstat` de `realpath` para que un enlace simbólico colgante (`ENOENT` en `realpath`)
 *   nunca se trate como archivo inexistente ni permita escribir a través del enlace.
 * - Rechaza con `denied` cualquier symlink saliente o irresoluble.
 */
export async function inspectDestinationTarget(
  targetPath: string,
  allowedDirs: readonly string[],
  home: string,
): Promise<DestinationInspection> {
  let lst: fs.Stats;
  try {
    lst = await fs.promises.lstat(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "error", message: `Cannot inspect destination '${targetPath}': ${errorMessage(error)}` };
  }

  if (lst.isSymbolicLink()) {
    let realTarget: string;
    try {
      realTarget = await fs.promises.realpath(targetPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return {
          status: "denied",
          message: `[DENIED] Destination symbolic link '${targetPath}' is dangling and cannot be verified within allowedDirectories.`,
        };
      }
      return {
        status: "denied",
        message: `[DENIED] Destination symbolic link '${targetPath}' could not be resolved: ${errorMessage(error)}`,
      };
    }

    if (!isCanonicalWithinAllowedDirs(realTarget, allowedDirs, home)) {
      return {
        status: "denied",
        message: `[DENIED] Destination symlink '${targetPath}' points outside allowedDirectories.`,
      };
    }

    try {
      const st = await fs.promises.stat(realTarget);
      return {
        status: "exists",
        realTarget,
        isDirectory: st.isDirectory(),
        isFile: st.isFile(),
        isSymlink: true,
      };
    } catch (error) {
      return { status: "error", message: `Cannot inspect destination '${targetPath}': ${errorMessage(error)}` };
    }
  }

  let realTarget = targetPath;
  try {
    realTarget = await fs.promises.realpath(targetPath);
  } catch {
    realTarget = targetPath;
  }

  return {
    status: "exists",
    realTarget,
    isDirectory: lst.isDirectory(),
    isFile: lst.isFile(),
    isSymlink: false,
  };
}

/** Calcula el presupuesto efectivo de tiempo reservando un margen para el cierre limpio del host. */
export function effectiveTimeoutMs(defaultMs: number, optionTimeoutMs?: number, marginMs = 1_500): number {
  if (optionTimeoutMs === undefined) return defaultMs;
  if (optionTimeoutMs <= marginMs + 500) {
    return Math.min(defaultMs, Math.max(optionTimeoutMs, 1));
  }
  return Math.min(defaultMs, optionTimeoutMs - marginMs);
}

/** Sufijo de un archivo temporal o de respaldo junto al destino: dos operaciones simultáneas (aun en el mismo milisegundo) no comparten nombre. */
export const tempSuffix = (): string => `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;

/** Cuántos bytes del comienzo de un archivo se miran para decidir si es binario. */
const BINARY_PROBE_BYTES = 8_192;

/** ¿Estos bytes parecen de un archivo binario? Un byte NUL en el primer bloque (`BINARY_PROBE_BYTES`) lo delata. */
export const looksBinary = (bytes: Uint8Array): boolean => bytes.subarray(0, BINARY_PROBE_BYTES).includes(0);

/** Lo mismo, leyendo solo el primer bloque del archivo (sin cargarlo entero). */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const block = Buffer.allocUnsafe(BINARY_PROBE_BYTES);
    const { bytesRead } = await handle.read(block, 0, BINARY_PROBE_BYTES, 0);
    return looksBinary(block.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** Cede el turno al bucle de eventos para no bloquearlo en recorridos largos. */
export const yieldEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Compite una promesa contra `AbortSignal` limpiando siempre el listener para evitar fugas de memoria. */
export async function raceAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<{ readonly aborted: true } | { readonly aborted: false; readonly value: T }> {
  if (signal?.aborted) return { aborted: true };
  if (signal === undefined) return { aborted: false, value: await promise };

  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<{ readonly aborted: true }>((resolve) => {
    onAbort = () => resolve({ aborted: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      promise.then((value) => ({ aborted: false as const, value })),
      abortPromise,
    ]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

/** Recorta líneas al presupuesto `budget` reservando espacio para cabecera y marcador de omisión. */
export function fitLinesToBudget(
  header: string,
  lines: readonly string[],
  budget: number,
  reserveChars = 180,
): { readonly shown: readonly string[]; readonly truncated: boolean } {
  const maxBody = Math.max(budget - Math.max(header.length + 1, reserveChars), 200);
  const shown: string[] = [];
  let used = 0;

  for (const line of lines) {
    const cost = line.length + (shown.length > 0 ? 1 : 0);
    if (shown.length > 0 && used + cost > maxBody) break;
    shown.push(line);
    used += cost;
  }

  return { shown, truncated: shown.length < lines.length };
}
