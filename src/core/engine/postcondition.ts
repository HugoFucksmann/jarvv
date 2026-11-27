/**
 * JARVIS Core — Poscondiciones de las escrituras del catálogo, comprobadas en el disco (N5, «verificar por código antes de preguntarle al modelo»).
 *
 * Una escritura exitosa deja algo que el código puede mirar: `create_folder` → la carpeta existe; `move_file` → el origen ya no está y el destino sí;
 * `write_file` → el archivo existe (y no está vacío si se le pidió escribir texto). Decisión 4 fallaba justo en esos hechos: rechazó un `Move-Item` correcto
 * (`ok` 0,51) y aprobó una copia donde se pidió mover (`docs/evaluacion/limitaciones/d3-2b.md`). Cumplida la poscondición el código aprueba sin consultar al modelo; no
 * cumplida, rechaza. Si no se puede comprobar (ruta relativa, referencia sin resolver, otra herramienta, error al leer el disco) devuelve `null` y decide el modelo.
 */

import fs from "node:fs";
import path from "node:path";

import type { VerifyCheckKey } from "../contracts.ts";
import type { DiskView } from "../types/disk.ts";

type Postcondition = "met" | "unmet" | null;

/** Cómo mira el disco: inyectable para las pruebas (definido en `types/disk.ts`). */
export type { DiskView };

export const REAL_DISK: DiskView = {
  exists: (p) => fs.existsSync(p),
  isDirectory: (p) => fs.statSync(p).isDirectory(),
  size: (p) => fs.statSync(p).size,
  readText: (p, maxBytes) => {
    try {
      const fd = fs.openSync(p, "r");
      try {
        const buffer = Buffer.alloc(maxBytes);
        const read = fs.readSync(fd, buffer, 0, maxBytes, 0);
        const chunk = buffer.subarray(0, read);
        return chunk.includes(0) ? null : chunk.toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return null;
    }
  },
  list: (p, max) => {
    try {
      return fs.readdirSync(p).slice(0, max);
    } catch {
      return null;
    }
  },
};

/** El valor es una ruta absoluta, sin marcadores `{{…}}` sin resolver. */
function absolutePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const p = value.trim();
  if (p === "" || p.includes("{{") || p.includes("\0")) return null;
  return path.isAbsolute(p) ? p : null;
}

type PostconditionRule = (args: Readonly<Record<string, unknown>>, disk: DiskView) => Postcondition;

/**
 * Una poscondición por herramienta que escribe en el disco. Agregar una herramienta que deja algo en el disco es agregar su fila; las que no dejan nada que mirar
 * (comandos, procesos) están en `NO_DISK_POSTCONDITION`. `tests/tool_specs.test.ts` falla si una herramienta que modifica el sistema no está en una de las dos.
 */
const POSTCONDITIONS: ReadonlyMap<string, PostconditionRule> = new Map<string, PostconditionRule>([
  [
    "create_folder",
    (args, disk) => {
      const dir = absolutePath(args.path);
      if (dir === null) return null;
      return disk.exists(dir) && disk.isDirectory(dir) ? "met" : "unmet";
    },
  ],
  [
    "write_file",
    (args, disk) => {
      const file = absolutePath(args.path);
      if (file === null) return null;
      if (!disk.exists(file) || disk.isDirectory(file)) return "unmet";
      // Con texto para escribir, un archivo vacío no es lo pedido (no se compara el tamaño exacto: la herramienta puede normalizar saltos de línea).
      // En modo `append` el archivo ya podía existir: solo se mira que exista.
      if (args.mode !== "append" && typeof args.content === "string" && args.content !== "" && disk.size(file) === 0) return "unmet";
      return "met";
    },
  ],
  [
    "edit_file",
    (args, disk) => {
      const file = absolutePath(args.path);
      if (file === null) return null;
      return disk.exists(file) && !disk.isDirectory(file) ? "met" : "unmet"; // el disco no dice qué texto cambió: solo que el archivo sigue ahí
    },
  ],
  [
    "copy_file",
    (args, disk) => {
      const source = absolutePath(args.source);
      const destination = absolutePath(args.destination);
      if (source === null || destination === null) return null;
      return disk.exists(destination) && disk.exists(source) ? "met" : "unmet"; // una copia deja las dos
    },
  ],
  [
    "move_file",
    (args, disk) => {
      if (!Array.isArray(args.items) || args.items.length === 0) return null;
      for (const item of args.items) {
        if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
        const source = absolutePath((item as Record<string, unknown>).source);
        const destination = absolutePath((item as Record<string, unknown>).destination);
        if (source === null || destination === null) return null;
        // Mover deja el destino y quita el origen (renombrar en el mismo lugar es un caso: el origen ya no existe con ese nombre).
        const sameName = process.platform === "win32" ? source.toLowerCase() === destination.toLowerCase() : source === destination;
        if (disk.exists(source) && !sameName) return "unmet";
        if (!disk.exists(destination)) return "unmet";
      }
      return "met";
    },
  ],
  [
    "delete_file",
    (args, disk) => {
      const target = absolutePath(args.path);
      if (target === null) return null;
      return disk.exists(target) ? "unmet" : "met"; // a la Papelera o permanente, la ruta ya no existe
    },
  ],
  [
    "archive_files",
    (args, disk) => {
      const destination = absolutePath(args.destination);
      if (destination === null) return null;
      if (!disk.exists(destination)) return "unmet";
      if (args.action === "extract") return disk.isDirectory(destination) ? "met" : "unmet";
      return !disk.isDirectory(destination) && disk.size(destination) > 0 ? "met" : "unmet";
    },
  ],
  [
    "download_file",
    (args, disk) => {
      // Con un destino explícito se comprueba el archivo; con carpeta y nombre deducido el disco no dice cuál es: decide el modelo.
      const destination = absolutePath(args.destination);
      if (destination === null) return null;
      return disk.exists(destination) && !disk.isDirectory(destination) && disk.size(destination) > 0 ? "met" : "unmet";
    },
  ],
  [
    "convert_file",
    (args, disk) => {
      const explicit = typeof args.destination === "string" ? args.destination.trim() : "";
      const source = typeof args.source === "string" ? args.source.trim() : "";
      const format = typeof args.format === "string" ? args.format.trim().replace(/^\./, "") : "";
      const derived = explicit !== "" ? explicit : source !== "" && format !== "" ? `${source.replace(/\.[^\\/.]*$/, "")}.${format}` : "";
      const destination = absolutePath(derived);
      if (destination === null) return null;
      return disk.exists(destination) && !disk.isDirectory(destination) ? "met" : "unmet";
    },
  ],

]);

/** Herramientas que modifican el sistema sin dejar nada que el código pueda comprobar en el disco: las decide el modelo. */
export const NO_DISK_POSTCONDITION: ReadonlySet<string> = new Set(["run_command", "stop_process", "pc_settings", "power", "open_on_screen", "clipboard", "play_media", "media_control"]);

/** ¿La herramienta declara una poscondición de disco? */
export const hasPostcondition = (tool: string): boolean => POSTCONDITIONS.has(tool);

export function postconditionOf(tool: string, args: Readonly<Record<string, unknown>> | null, disk: DiskView = REAL_DISK): Postcondition {
  if (args === null) return null;
  const rule = POSTCONDITIONS.get(tool);
  if (rule === undefined) return null;
  try {
    return rule(args, disk);
  } catch {
    return null;
  }
}

/** Herramientas de lectura cuyo resultado es el dato mismo (no un extracto de un buscador ni la salida de un comando): con estado `ok` y contenido, `ok` lo responde el código. */
const DETERMINISTIC_READS: ReadonlySet<string> = new Set(["list_folder", "read_file", "system_info"]);

/** Resumen que dice que no hay nada: no es un dato aunque el estado sea `ok` (p. ej. «Directorio vacío.» para `depth: 0`). */
const EMPTY_RESULT = /^\s*(?:directorio vac[ií]o|empty directory|\(?empty\)?|no hay (?:archivos|elementos)|no files)\W*$/i;

/** ¿El código puede responder la pregunta `ok` de la verificación? Estado `ok` de una lectura determinista con contenido. */
export function codeAnswersOk(tool: string, status: string, summary: string | null): boolean {
  if (!DETERMINISTIC_READS.has(tool) || status !== "ok") return false;
  if (summary === null || summary.trim() === "") return false;
  return !EMPTY_RESULT.test(summary);
}

/**
 * Búsqueda web que ya respondió su consulta: `web_search` cierra `found` solo cuando su propio juez puntuó los fragmentos contra el `need` y alguno responde (sin modelo, el techo es `partial`;
 * ver `tools/web`). Preguntarle a Decisión 4 «¿cumple el paso?» sobre ese mismo resultado es juzgar dos veces lo mismo con un modelo más débil, y falló en trazas reales (`cumple` 0,44 sobre una
 * búsqueda `found` de hospedaje: el paso pedía «ubicación, precio, tipo» y el `need` era el tema). Que el resultado cubra TODO el pedido lo decide la lista de pendientes y la confirmación D5.
 * `partial`, `not_found` y `no_results` siguen yendo al modelo (o al rechazo por falta de datos).
 */
const WEB_FOUND = /^\s*status:\s*found\b/i;

/** ¿El código puede responder la pregunta `cumple` de la verificación? Una `web_search` con estado `found` del propio buscador. */
export function codeAnswersCumple(tool: string, status: string, summary: string | null): boolean {
  return tool === "web_search" && status === "ok" && summary !== null && WEB_FOUND.test(summary);
}

/**
 * Las preguntas de `VERIFY_CHECKS` que el código ya responde para esta llamada, con su valor: no se le preguntan al modelo y entran tal cual al veredicto (`verdictOf`). Una sola definición para producción
 * (`verifyCall`) y para el laboratorio de eval, que arma la misma consulta. Una búsqueda `found` trae datos, así que resuelve también `ok`.
 */
export function knownVerifyAnswers(tool: string, status: string, summary: string | null): Partial<Record<VerifyCheckKey, number>> {
  const cumple = codeAnswersCumple(tool, status, summary);
  return { ...(cumple || codeAnswersOk(tool, status, summary) ? { ok: 1 } : {}), ...(cumple ? { cumple: 1 } : {}) };
}
