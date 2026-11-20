/**
 * `jarvis_files`: resolución de rutas y alias conocidos (`home`, `desktop`, `documents`, `downloads`),
 * comprobación de `allowedDirectories`, límite de enlaces simbólicos y formateo de tamaños y fechas.
 */

import fs from "node:fs";
import path from "node:path";
import type { UserEnvironment } from "../../core/environment.ts";
import {
  checkAllowedDirectory,
  expandHome,
  isAnyAbsolute,
  isWinPath,
  stripExtendedPrefix,
} from "../../core/policy/allowedDirs.ts";
import { errorMessage } from "../../core/utils.ts";

export const KNOWN_ALIASES = ["home", "desktop", "documents", "downloads"] as const;
export type KnownAlias = (typeof KNOWN_ALIASES)[number];

export type ResolvedFolder =
  | { readonly ok: true; readonly targetPath: string; readonly realRoot: string }
  | { readonly ok: false; readonly denied: boolean; readonly message: string };

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

function resolveAlias(raw: string, env: UserEnvironment): { readonly found: true; readonly path: string } | { readonly found: false; readonly missingAlias?: KnownAlias } {
  const lower = raw.toLowerCase();
  if (lower === "home") return env.home ? { found: true, path: env.home } : { found: false, missingAlias: "home" };
  if (lower === "desktop") return env.desktop ? { found: true, path: env.desktop } : { found: false, missingAlias: "desktop" };
  if (lower === "documents") return env.documents ? { found: true, path: env.documents } : { found: false, missingAlias: "documents" };
  if (lower === "downloads") return env.downloads ? { found: true, path: env.downloads } : { found: false, missingAlias: "downloads" };
  return { found: false };
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
  let env: UserEnvironment;
  try {
    env = await getEnv();
  } catch (error) {
    return { ok: false, denied: false, message: `Could not read user environment: ${errorMessage(error)}` };
  }

  const trimmed = rawPath?.trim() ?? "";
  let candidate: string;
  if (trimmed === "") {
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
      message: `'path' must be an absolute path or one of: ${KNOWN_ALIASES.join(", ")} (got '${trimmed}').`,
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

  const targetPath = isWinPath(cleanCandidate)
    ? path.win32.normalize(cleanCandidate.replace(/\//g, "\\"))
    : path.resolve(cleanCandidate);

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

  return { ok: true, targetPath, realRoot };
}

/** Cede el turno al bucle de eventos para no bloquearlo en recorridos largos. */
export const yieldEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
