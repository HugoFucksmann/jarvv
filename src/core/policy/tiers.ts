/**
 * JARVIS Core — Aprobación por niveles (idea 5 de `docs/evaluacion/JARVIS_EVALUACION.md`), decidida por código.
 *
 * Con `approvalTiers` activo (por defecto encendido) clasifica las escrituras por riesgo en lugar de aplicar `autoMode` binario:
 * - **Verde** — reversible y sin sobrescribir, dentro de las carpetas del usuario (crear una carpeta, un archivo que no existe, mover a un destino que no existe): sin
 *   confirmación y sin revisión de Decisión 3; la poscondición se comprueba en el disco (`engine/postcondition.ts`).
 * - **Amarillo** — el resto de las escrituras del catálogo (agregar a un archivo, fuera de las carpetas del usuario, herramientas no clasificadas): sin confirmación con `autoMode`, con
 *   Decisión 3 y su umbral estricto (`BUDGET.sensitiveApprove`).
 * - **Rojo** — sobrescribir un archivo que existe, ejecutar comandos que modifican, cortar procesos, herramientas no catalogadas: siempre confirma el usuario.
 *
 * Lo que Guard ya trata como obligatorio (rutas sensibles, datos sensibles hacia internet) y las coincidencias de la lista negra siguen pidiendo confirmación o rechazando
 * como siempre. Las lecturas no pasan por acá. No hay modelos en esta clasificación.
 */

import fs from "node:fs";
import path from "node:path";

import type { UserEnvironment } from "../environment.ts";
import { canonicalPath, isAnyAbsolute, isPathInsideCanonical, isWinPath, stripExtendedPrefix } from "./allowedDirs.ts";

export type ApprovalTier = "green" | "yellow" | "red";

export interface TierDisk {
  exists(p: string): boolean;
  canonical?(p: string): string;
}
const REAL: TierDisk = { exists: (p) => fs.existsSync(p), canonical: canonicalPath };

/**
 * La ruta absoluta y canónica de un argumento, o `null` si no se puede resolver. Una ruta relativa se resuelve contra `baseDir` (la carpeta de trabajo de la herramienta) antes
 * de mirar si existe; sin una base absoluta, o con un marcador sin resolver, queda sin resolver (amarillo).
 */
function absolute(value: unknown, canon: (p: string) => string, baseDir?: string): string | null {
  if (typeof value !== "string") return null;
  const p = stripExtendedPrefix(value);
  if (p === "" || p.includes("{{") || p.includes("\0")) return null;
  if (isAnyAbsolute(p)) return canon(p);
  const base = baseDir === undefined ? "" : stripExtendedPrefix(baseDir.trim());
  if (base === "" || base.includes("{{") || base.includes("\0") || !isAnyAbsolute(base)) return null;
  return canon(isWinPath(base) ? path.win32.resolve(base, p.replace(/\//g, "\\")) : path.posix.resolve(base, p));
}

const dirnameOf = (p: string): string => (isWinPath(p) ? path.win32.dirname(p) : path.posix.dirname(p));

/** ¿La ruta está dentro de una carpeta del usuario (inicio, escritorio, documentos, descargas)? */
function underUserFolder(p: string, env: UserEnvironment, canon: (target: string) => string): boolean {
  return [env.home, env.desktop, env.documents, env.downloads].some(
    (f) => typeof f === "string" && f !== "" && isPathInsideCanonical(canon(f), p),
  );
}

/** El nivel de una escritura del catálogo ya con sus argumentos resueltos. Sin información suficiente, amarillo (nunca verde por omisión). */
export function approvalTierOf(tool: string, args: Readonly<Record<string, unknown>>, env: UserEnvironment, disk: TierDisk = REAL, baseDir?: string): ApprovalTier {
  const canon = disk.canonical ?? canonicalPath;
  try {
    switch (tool) {
      case "create_directory": {
        const dir = absolute(args.path, canon, baseDir);
        return dir !== null && underUserFolder(dir, env, canon) ? "green" : "yellow";
      }
      case "write_file": {
        const raw = typeof args.path === "string" ? args.path.trim() : "";
        const file = absolute(args.path, canon, baseDir);
        if (file === null || !underUserFolder(file, env, canon)) return "yellow";
        const fileExists = disk.exists(file) || (raw !== "" && disk.exists(raw));
        if (!fileExists) {
          const parentExists = disk.exists(dirnameOf(file)) || (raw !== "" && disk.exists(dirnameOf(raw)));
          return parentExists ? "green" : "yellow"; // sin la carpeta contenedora la escritura falla: no es verde
        }
        return args.mode === "append" ? "yellow" : "red"; // agregar es amarillo; reescribir un archivo que existe es sobrescribir
      }
      case "move_file": {
        const source = absolute(args.source, canon, baseDir);
        const rawDest = typeof args.destination === "string" ? args.destination.trim() : "";
        const destination = absolute(args.destination, canon, baseDir);
        if (source === null || destination === null || !underUserFolder(source, env, canon) || !underUserFolder(destination, env, canon)) return "yellow";
        if (disk.exists(destination) || (rawDest !== "" && disk.exists(rawDest))) return "red";
        const parentExists = disk.exists(dirnameOf(destination)) || (rawDest !== "" && disk.exists(dirnameOf(rawDest)));
        return parentExists ? "green" : "yellow";
      }
      case "edit_block": // en pausa: si se incorpora al catálogo, sigue en rojo hasta que se clasifique
      case "run_command": // un comando que modifica puede hacer cualquier cosa
      case "stop_process":
        return "red";
      default:
        return "yellow";
    }
  } catch {
    return "yellow";
  }
}
