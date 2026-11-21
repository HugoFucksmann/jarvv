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

import type { UserEnvironment } from "../environment.ts";
import { dirnameOf } from "../tools/filePaths.ts";
import { canonicalPath, isAnyAbsolute, isPathInsideCanonical, stripExtendedPrefix } from "./allowedDirs.ts";

export type ApprovalTier = "green" | "yellow" | "red";

export interface TierDisk {
  exists(p: string): boolean;
  canonical?(p: string): string;
}
const REAL: TierDisk = { exists: (p) => fs.existsSync(p), canonical: canonicalPath };

/** La ruta absoluta y canónica de un argumento, o `null` si no es absoluta o trae un marcador sin resolver (las herramientas nativas no aceptan rutas relativas: queda en amarillo). */
function absolute(value: unknown, canon: (p: string) => string): string | null {
  if (typeof value !== "string") return null;
  const p = stripExtendedPrefix(value);
  if (p === "" || p.includes("{{") || p.includes("\0")) return null;
  return isAnyAbsolute(p) ? canon(p) : null;
}

/** ¿La ruta está dentro de una carpeta del usuario (inicio, escritorio, documentos, descargas)? */
function underUserFolder(p: string, env: UserEnvironment, canon: (target: string) => string): boolean {
  return [env.home, env.desktop, env.documents, env.downloads].some(
    (f) => typeof f === "string" && f !== "" && isPathInsideCanonical(canon(f), p),
  );
}

/** Lo que necesita la regla de nivel de una herramienta. */
interface TierContext {
  readonly env: UserEnvironment;
  readonly disk: TierDisk;
  readonly canon: (p: string) => string;
}

type TierRule = (args: Readonly<Record<string, unknown>>, c: TierContext) => ApprovalTier;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Una ruta ya existe en el disco; se mira la forma escrita y la resuelta (el disco inyectable de las pruebas solo conoce una de las dos). */
const existsAt = (disk: TierDisk, resolved: string, raw: string): boolean => disk.exists(resolved) || (raw !== "" && disk.exists(raw));

/** El archivo o carpeta nuevo va dentro de las carpetas del usuario y la carpeta que lo contendrá existe (o la herramienta la crea). */
function newTargetTier(raw: string, c: TierContext, createsParents = false): ApprovalTier {
  const target = absolute(raw, c.canon);
  if (target === null || !underUserFolder(target, c.env, c.canon)) return "yellow";
  if (existsAt(c.disk, target, raw)) return "red";
  const parentExists = existsAt(c.disk, dirnameOf(target), dirnameOf(raw)) || createsParents;
  return parentExists ? "green" : "yellow"; // sin la carpeta contenedora la escritura falla: no es verde
}

/** Los pares `{ source, destination }` de `items` (`move_file`). */
function movePairs(args: Readonly<Record<string, unknown>>): Array<{ source: string; destination: string }> | null {
  if (!Array.isArray(args.items) || args.items.length === 0) return null;
  const out: Array<{ source: string; destination: string }> = [];
  for (const item of args.items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const pair = item as Record<string, unknown>;
    const source = str(pair.source);
    const destination = str(pair.destination);
    if (source === "" || destination === "") return null;
    out.push({ source, destination });
  }
  return out;
}

/** Destino de una conversión: el pedido, o el origen con la extensión nueva (como lo deduce la herramienta). */
function convertDestination(args: Readonly<Record<string, unknown>>): string {
  const explicit = str(args.destination);
  if (explicit !== "") return explicit;
  const source = str(args.source);
  const format = str(args.format).replace(/^\./, "");
  if (source === "" || format === "") return "";
  const dot = source.search(/\.[^\\/.]*$/);
  return `${dot === -1 ? source : source.slice(0, dot)}.${format}`;
}

/**
 * Una regla de nivel por herramienta que escribe del catálogo. Agregar una herramienta que escribe es agregar su fila; `tests/tool_specs.test.ts` falla si una
 * herramienta que modifica el sistema no tiene la suya (sin fila rige el amarillo, que no es una clasificación sino un valor por omisión).
 */
const TIER_RULES: ReadonlyMap<string, TierRule> = new Map<string, TierRule>([
  ["create_folder", (args, c) => {
      const dir = absolute(args.path, c.canon);
      return dir !== null && underUserFolder(dir, c.env, c.canon) ? "green" : "yellow"; // asegurar que existe no pisa nada
    }],
  ["write_file", (args, c) => {
      const raw = str(args.path);
      const file = absolute(args.path, c.canon);
      if (file === null || !underUserFolder(file, c.env, c.canon)) return "yellow";
      if (!existsAt(c.disk, file, raw)) return newTargetTier(raw, c, args.createFolders === true);
      if (args.mode === "create_only") return "yellow"; // la herramienta se niega a pisar: no hay nada que confirmar
      return args.mode === "append" ? "yellow" : "red"; // agregar es amarillo; reescribir un archivo que existe es sobrescribir
    }],
  ["edit_file", () => "yellow"], // edita lo que existe: nunca verde; la herramienta exige una coincidencia única
  ["copy_file", (args, c) => {
      const source = absolute(args.source, c.canon);
      if (source === null || !underUserFolder(source, c.env, c.canon)) return "yellow";
      return newTargetTier(str(args.destination), c);
    }],
  ["move_file", (args, c) => {
      const pairs = movePairs(args);
      if (pairs === null) return "yellow";
      let tier: ApprovalTier = "green";
      for (const { source, destination } of pairs) {
        const src = absolute(source, c.canon);
        if (src === null || !underUserFolder(src, c.env, c.canon)) return "yellow";
        const t = newTargetTier(destination, c);
        if (t === "yellow") return "yellow";
        if (t === "red") tier = "red";
      }
      return tier;
    }],
  ["delete_file", () => "red"], // borrar no se deshace salvo en la Papelera: siempre confirma el usuario
  ["archive_files", (args, c) => {
      if (args.action === "extract") return "yellow"; // escribe muchos archivos de una vez
      const sources = Array.isArray(args.sources) ? args.sources.map(str) : [];
      for (const s of sources) {
        const abs = absolute(s, c.canon);
        if (abs === null || !underUserFolder(abs, c.env, c.canon)) return "yellow";
      }
      return newTargetTier(str(args.destination), c);
    }],
  ["convert_file", (args, c) => {
      const source = absolute(args.source, c.canon);
      if (source === null || !underUserFolder(source, c.env, c.canon)) return "yellow";
      const destination = convertDestination(args);
      return destination === "" ? "yellow" : newTargetTier(destination, c);
    }],
  ["play_media", () => "green"], // no deja nada en el disco ni se pierde nada: reproducir es reversible
  ["media_control", () => "green"],
  ["download_file", (args, c) => {
      // Baja contenido de internet al disco: nunca verde. Un destino que ya existe es sobrescribir (rojo); lo demás pasa por Decisión 3 estricta.
      const destination = str(args.destination);
      if (destination === "") return "yellow";
      const target = absolute(destination, c.canon);
      return target !== null && existsAt(c.disk, target, destination) ? "red" : "yellow";
    }],
  ["pc_settings", (args) => (args.action === "get" ? "green" : "yellow")], // leer un ajuste no cambia nada; cambiarlo sí, y se puede revertir
  ["power", (args) => (args.action === "restart" || args.action === "shutdown" ? "red" : "yellow")], // reiniciar o apagar pierde el trabajo sin guardar
  ["open_on_screen", (args, c) => {
      const target = str(args.target);
      const kind = str(args.type) === "" || str(args.type) === "auto" ? (/^https?:\/\//i.test(target) ? "url" : isAnyAbsolute(target) || /^(?:home|desktop|documents|downloads|~)(?:[\\/]|$)/i.test(target) ? "path" : "app") : str(args.type);
      if (kind === "url") return "green"; // la herramienta rechaza esquemas peligrosos
      if (kind === "path") {
        const resolved = absolute(target, c.canon);
        return resolved === null || underUserFolder(resolved, c.env, c.canon) ? "green" : "yellow";
      }
      return "yellow"; // lanzar una aplicación
    }],
  ["clipboard", (args) => (args.action === "read" ? "green" : "yellow")], // escribir pisa lo que el usuario tenía copiado
  ["run_command", () => "red"], // un comando que modifica puede hacer cualquier cosa
  ["stop_process", () => "red"],
]);

/** ¿La herramienta tiene una regla de nivel propia? (Sin ella, `approvalTierOf` da amarillo por omisión.) */
export const hasTierRule = (tool: string): boolean => TIER_RULES.has(tool);

/** El nivel de una escritura del catálogo ya con sus argumentos resueltos. Sin información suficiente, amarillo (nunca verde por omisión). */
export function approvalTierOf(tool: string, args: Readonly<Record<string, unknown>>, env: UserEnvironment, disk: TierDisk = REAL): ApprovalTier {
  const rule = TIER_RULES.get(tool);
  if (rule === undefined) return "yellow";
  try {
    return rule(args, { env, disk, canon: disk.canonical ?? canonicalPath });
  } catch {
    return "yellow";
  }
}
