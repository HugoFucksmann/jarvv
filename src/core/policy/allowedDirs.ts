/**
 * JARVIS Core — Resolución canónica y verificación de `allowedDirectories`.
 *
 * Comparte la lógica entre el motor (`engine/callRunner.ts`, `tiers.ts`, `sensitivePaths.ts`) y los proveedores
 * (`FilesProvider`, `TerminalProvider`):
 * - Resuelve enlaces simbólicos (`fs.realpathSync`) sobre rutas reales, descendiendo desde el ancestro existente cuando la hoja todavía no existe.
 * - Maneja prefijos extendidos de Windows (`\\?\`, `\\.\`, `\\?\UNC\`) y rutas UNC (`\\servidor\recurso`).
 * - Conserva comportamiento determinista para rutas de Windows en pruebas que corren bajo Linux (`process.platform !== "win32"`).
 */

import fs from "node:fs";
import path from "node:path";

export type AllowedDirResult =
  | { readonly allowed: true; readonly canonical: string }
  | { readonly allowed: false; readonly reason: "outside" | "unresolvable"; readonly canonical?: string };

/** Quita prefijos de espacio de nombres Win32 (`\\?\`, `\\.\`, `\\?\UNC\`). */
export function stripExtendedPrefix(p: string): string {
  const trimmed = p.trim();
  if (/^\\\\[?.]\\unc\\/i.test(trimmed)) return `\\\\${trimmed.slice(8)}`;
  if (/^\/\/[?.]\/unc\//i.test(trimmed)) return `//${trimmed.slice(8)}`;
  if (/^\\\\[?.]\\[A-Za-z]:/i.test(trimmed)) return trimmed.slice(4);
  if (/^\/\/[?.]\/[A-Za-z]:/i.test(trimmed)) return trimmed.slice(4);
  if (/^\\\\\?\\/.test(trimmed)) return trimmed.slice(4);
  if (/^\/\/\?\//.test(trimmed)) return trimmed.slice(4);
  return trimmed;
}

/** ¿Tiene forma de ruta absoluta de Windows (`C:\...`, `C:/...`, `\\servidor\recurso`, `//servidor/recurso`)? */
export function isWinPath(p: string): boolean {
  const s = stripExtendedPrefix(p);
  return /^[A-Za-z]:(?:[\\/]|$)/.test(s) || /^\\\\[^\\]+[\\/][^\\]+/.test(s) || /^\/\/[^/]+\/[^/]+/.test(s);
}

/** ¿Tiene forma de ruta absoluta POSIX (`/ruta`) sin ser UNC? */
export function isPosixPath(p: string): boolean {
  const s = stripExtendedPrefix(p);
  return s.startsWith("/") && !/^\/\/[^/]+\/[^/]+/.test(s);
}

/** ¿Es una ruta absoluta (Windows o POSIX) independiente de la plataforma del proceso? */
export function isAnyAbsolute(p: string): boolean {
  return isWinPath(p) || isPosixPath(p);
}

const realpathNative = (p: string): string =>
  typeof fs.realpathSync.native === "function" ? fs.realpathSync.native(p) : fs.realpathSync(p);

/**
 * Resuelve `target` con `realpathSync`, soportando que las hojas aún no existan (resuelve el ancestro más profundo
 * existente y concatena el sufijo) y enlaces simbólicos rotos (`lstatSync` + `readlinkSync`).
 */
export function resolveWithRealpathSync(target: string, depth = 0): string {
  const normalized = path.normalize(target);
  const parts: string[] = [];
  let cur = normalized;

  while (true) {
    try {
      const real = realpathNative(cur);
      return parts.length === 0 ? real : path.join(real, ...parts.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" && depth < 10) {
        try {
          if (fs.lstatSync(cur).isSymbolicLink()) {
            const linked = fs.readlinkSync(cur);
            const nextTarget = path.isAbsolute(linked) ? linked : path.resolve(path.dirname(cur), linked);
            const resolvedTarget = resolveWithRealpathSync(nextTarget, depth + 1);
            return parts.length === 0 ? resolvedTarget : path.join(resolvedTarget, ...parts.reverse());
          }
        } catch {
          // Si lstatSync falla, seguimos subiendo hacia un ancestro que exista.
        }
      }
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        return normalized;
      }
      const parent = path.dirname(cur);
      if (parent === cur) return normalized;
      parts.push(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * Devuelve una forma canónica comparable de `target`:
 * - Limpia prefijos extendidos `\\?\` y `\\?\UNC\`.
 * - En rutas de Windows evaluadas fuera de Windows (p. ej. pruebas en Linux), normaliza con `path.win32`.
 * - En rutas del SO anfitrión, resuelve enlaces simbólicos y nombres reales con `fs.realpathSync`.
 */
export function canonicalPath(target: string): string {
  const clean = stripExtendedPrefix(target);
  if (clean === "") return "";
  if (isWinPath(clean) && process.platform !== "win32") {
    return path.win32.normalize(clean.replace(/\//g, "\\"));
  }
  return resolveWithRealpathSync(clean);
}

/** Expande un prefijo `~` si se conoce `home`. */
export function expandHome(p: string, home?: string): string {
  if (!home) return p;
  if (p === "~") return home;
  if (/^~[\\/]/.test(p)) {
    return isWinPath(home) ? path.win32.join(home, p.slice(2)) : path.join(home, p.slice(2));
  }
  return p;
}

/** Compara si `child` es `parent` o está dentro de `parent`, resolviendo symlinks y normalizando rutas. */
export function isPathInsideCanonical(parent: string, child: string): boolean {
  const p = canonicalPath(parent);
  const c = canonicalPath(child);
  if (!p || !c) return false;

  if (isWinPath(p) || isWinPath(c)) {
    if (!isWinPath(p) || !isWinPath(c)) return false;
    const rel = path.win32.relative(p.toLowerCase(), c.toLowerCase());
    return rel === "" || (rel !== ".." && !rel.startsWith("..\\") && !path.win32.isAbsolute(rel));
  }

  const impl = process.platform === "win32" ? path.win32 : path.posix;
  const rel = impl.relative(p, c);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${impl.sep}`) && !impl.isAbsolute(rel));
}

const UNRESOLVABLE_PATTERN = /(?:^~|\{\{|%[^%]+%|\$env:|\$[A-Za-z_{]|\$\(|\0)/i;

/**
 * Comprueba si `target` pertenece a alguno de `allowedDirs`.
 * - Lista vacía (`allowedDirs.length === 0`) => permitido sin restricción.
 * - Variables sin resolver, marcadores `{{...}}`, o rutas relativas sin `cwdBase` absoluto => `"unresolvable"`.
 * - Ruta resoluble fuera de todas las carpetas permitidas => `"outside"`.
 */
export function checkAllowedDirectory(
  target: string,
  allowedDirs: readonly string[],
  opts: { readonly cwdBase?: string; readonly home?: string } = {},
): AllowedDirResult {
  if (allowedDirs.length === 0) return { allowed: true, canonical: target };
  const rawTrimmed = target.trim();
  if (rawTrimmed === "" || rawTrimmed.includes("\0")) return { allowed: false, reason: "unresolvable" };

  const expanded = expandHome(rawTrimmed, opts.home);
  if (UNRESOLVABLE_PATTERN.test(expanded)) {
    return { allowed: false, reason: "unresolvable" };
  }

  const clean = stripExtendedPrefix(expanded);
  let resolved: string;
  if (isAnyAbsolute(clean)) {
    resolved = clean;
  } else if (opts.cwdBase && isAnyAbsolute(opts.cwdBase)) {
    const baseClean = stripExtendedPrefix(opts.cwdBase);
    resolved = isWinPath(baseClean)
      ? path.win32.resolve(baseClean.replace(/\//g, "\\"), clean.replace(/\//g, "\\"))
      : path.posix.resolve(baseClean, clean);
  } else {
    return { allowed: false, reason: "unresolvable" };
  }

  const canonical = canonicalPath(resolved);
  for (const dir of allowedDirs) {
    const trimmedDir = dir.trim();
    if (!trimmedDir) continue;
    const expandedDir = expandHome(trimmedDir, opts.home);
    if (isPathInsideCanonical(expandedDir, canonical)) {
      return { allowed: true, canonical };
    }
  }
  return { allowed: false, reason: "outside", canonical };
}
