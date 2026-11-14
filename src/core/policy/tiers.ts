/**
 * JARVIS Core — Aprobación por niveles (idea 5 de `docs/JARVIS_EVALUACION.md`), decidida por código.
 *
 * Con `approvalTiers` encendido (opt-in, `jarvis-config.json`) reemplaza al `autoMode` binario («se pregunta todo» o «no se pregunta nunca y la última barrera es un 2B»):
 * - **Verde** — reversible y sin sobrescribir, dentro de las carpetas del usuario (crear una carpeta, un archivo que no existe, mover a un destino que no existe): sin
 *   confirmación y sin revisión de Decisión 3; la poscondición se comprueba en el disco (`engine/postcondition.ts`).
 * - **Amarillo** — el resto de las escrituras del catálogo (agregar a un archivo, fuera de las carpetas del usuario, herramientas no clasificadas): sin confirmación, con
 *   Decisión 3 y su umbral estricto (`BUDGET.sensitiveApprove`).
 * - **Rojo** — sobrescribir un archivo que existe, ejecutar comandos que modifican, cortar procesos, herramientas no catalogadas: siempre confirma el usuario.
 *
 * Lo que Guard ya trata como obligatorio (rutas sensibles, datos sensibles hacia internet) y las coincidencias de la lista negra siguen pidiendo confirmación o rechazando
 * como siempre: son rojas. Las lecturas no pasan por acá. No hay modelos en esta clasificación.
 */

import fs from "node:fs";
import path from "node:path";

import type { UserEnvironment } from "../environment.ts";
import { isPathInside } from "./guard.ts";

export type ApprovalTier = "green" | "yellow" | "red";

export interface TierDisk {
  exists(p: string): boolean;
}
const REAL: TierDisk = { exists: (p) => fs.existsSync(p) };

function absolute(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const p = value.trim();
  if (p === "" || p.includes("{{") || p.includes("\0")) return null;
  return path.isAbsolute(p) ? p : null;
}

/** ¿La ruta está dentro de una carpeta del usuario (inicio, escritorio, documentos, descargas)? */
function underUserFolder(p: string, env: UserEnvironment): boolean {
  return [env.home, env.desktop, env.documents, env.downloads].some((f) => typeof f === "string" && f !== "" && isPathInside(f, p));
}

/** El nivel de una escritura del catálogo ya con sus argumentos resueltos. Sin información suficiente, amarillo (nunca verde por omisión). */
export function approvalTierOf(tool: string, args: Readonly<Record<string, unknown>>, env: UserEnvironment, disk: TierDisk = REAL): ApprovalTier {
  try {
    switch (tool) {
      case "create_directory": {
        const dir = absolute(args.path);
        return dir !== null && underUserFolder(dir, env) ? "green" : "yellow";
      }
      case "write_file": {
        const file = absolute(args.path);
        if (file === null || !underUserFolder(file, env)) return "yellow";
        if (!disk.exists(file)) return disk.exists(path.dirname(file)) ? "green" : "yellow"; // sin la carpeta contenedora la escritura falla: no es verde
        return args.mode === "append" ? "yellow" : "red"; // agregar es amarillo; reescribir un archivo que existe es sobrescribir
      }
      case "move_file": {
        const source = absolute(args.source);
        const destination = absolute(args.destination);
        if (source === null || destination === null || !underUserFolder(source, env) || !underUserFolder(destination, env)) return "yellow";
        if (disk.exists(destination)) return "red";
        return disk.exists(path.dirname(destination)) ? "green" : "yellow";
      }
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
