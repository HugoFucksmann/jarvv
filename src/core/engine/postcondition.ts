/**
 * JARVIS Core — Poscondiciones de las escrituras del catálogo, comprobadas en el disco (N5, «verificar por código antes de preguntarle al modelo»).
 *
 * Una escritura exitosa deja algo que el código puede mirar: `create_directory` → la carpeta existe; `move_file` → el origen ya no está y el destino sí;
 * `write_file` → el archivo existe (y no está vacío si se le pidió escribir texto). Decisión 4 fallaba justo en esos hechos: rechazó un `Move-Item` correcto
 * (`ok` 0,51) y aprobó una copia donde se pidió mover (`docs/limitaciones/d3-2b.md`). Cumplida la poscondición el código aprueba sin consultar al modelo; no
 * cumplida, rechaza. Si no se puede comprobar (ruta relativa, referencia sin resolver, otra herramienta, error al leer el disco) devuelve `null` y decide el modelo.
 */

import fs from "node:fs";
import { pathApiFor } from "../policy/guard.ts";

export type Postcondition = "met" | "unmet" | null;

/** Cómo mira el disco: inyectable para las pruebas. */
export interface DiskView {
  exists(p: string): boolean;
  isDirectory(p: string): boolean;
  size(p: string): number;
}

export const REAL_DISK: DiskView = {
  exists: (p) => fs.existsSync(p),
  isDirectory: (p) => fs.statSync(p).isDirectory(),
  size: (p) => fs.statSync(p).size,
};

/** El valor es una ruta absoluta sin referencias `{{ref:…}}` sin resolver. */
function absolutePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const p = value.trim();
  if (p === "" || p.includes("{{") || p.includes("\0")) return null;
  return pathApiFor(p).isAbsolute(p) ? p : null;
}

export function postconditionOf(tool: string, args: Readonly<Record<string, unknown>> | null, disk: DiskView = REAL_DISK): Postcondition {
  if (args === null) return null;
  try {
    switch (tool) {
      case "create_directory": {
        const dir = absolutePath(args.path);
        if (dir === null) return null;
        return disk.exists(dir) && disk.isDirectory(dir) ? "met" : "unmet";
      }
      case "move_file": {
        const source = absolutePath(args.source);
        const destination = absolutePath(args.destination);
        if (source === null || destination === null) return null;
        if (disk.exists(source)) return "unmet";
        if (disk.exists(destination)) {
          // Mover «a una carpeta» deja el archivo dentro de ella.
          const api = pathApiFor(source, destination);
          if (disk.isDirectory(destination)) return disk.exists(api.join(destination, api.basename(source))) ? "met" : "unmet";
          return "met";
        }
        return "unmet";
      }
      case "write_file": {
        const file = absolutePath(args.path);
        if (file === null) return null;
        if (!disk.exists(file) || disk.isDirectory(file)) return "unmet";
        // Con texto para escribir, un archivo vacío no es lo pedido (no se compara el tamaño exacto: la herramienta puede normalizar saltos de línea).
        // En modo `append` el archivo ya podía existir: solo se mira que exista.
        if (args.mode !== "append" && typeof args.content === "string" && args.content !== "" && disk.size(file) === 0) return "unmet";
        return "met";
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Herramientas de lectura cuyo resultado es el dato mismo (no un extracto de un buscador ni la salida de un comando): con estado `ok` y contenido, `ok` lo responde el código. */
const DETERMINISTIC_READS: ReadonlySet<string> = new Set(["list_directory", "read_file", "read_multiple_files", "list_processes"]);

/** Resumen que dice que no hay nada: no es un dato aunque el estado sea `ok` (p. ej. «Directorio vacío.» para `depth: 0`). */
const EMPTY_RESULT = /^\s*(?:directorio vac[ií]o|empty directory|\(?empty\)?|no hay (?:archivos|elementos)|no files)\W*$/i;

/** ¿El código puede responder la pregunta `ok` de la verificación? Estado `ok` de una lectura determinista con contenido. */
export function codeAnswersOk(tool: string, status: string, summary: string | null): boolean {
  if (!DETERMINISTIC_READS.has(tool) || status !== "ok") return false;
  if (summary === null || summary.trim() === "") return false;
  return !EMPTY_RESULT.test(summary);
}
