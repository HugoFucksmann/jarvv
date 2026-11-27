/**
 * JARVIS Core — Observación de los artefactos que deja una llamada (el estado real, no lo que la herramienta dice haber hecho).
 *
 * Tras una escritura exitosa el código mira las rutas que la llamada tocó (`pathValuesOf`: sirve a toda herramienta con argumentos de ruta, sin una regla por herramienta)
 * y guarda lo que quedó como un hecho `artifact_<huella de la ruta>`: la ruta, el tamaño y un esbozo. Un hecho se pisa con cada observación de la misma ruta, así que siempre
 * muestra el estado más reciente, y llega a todos los modelos por el bloque de entorno (`ENV`), igual que el hecho `process`. Sin esto el resumen de una escritura es «ok,
 * 693 B»: nadie ve el archivo, y por eso no se puede corregir (un documento reenviado entero con `append` quedaba con cada sección repetida y nadie lo notaba).
 *
 * El esbozo es genérico: para un texto con encabezados (`#`), cada encabezado con su primera línea de contenido y las repeticiones contadas (`×4`); para otro texto, el
 * comienzo y el final. No usa modelos. Lo que no se puede mirar (ruta relativa, binario, sin disco que lea) se omite sin error. Con lo obligatorio de Guard (rutas sensibles)
 * no se observa nada: esa llamada ya pasó por la confirmación del usuario y su contenido no tiene por qué entrar a los prompts.
 */

import path from "node:path";

import type { Op, TaskContext } from "../ctx/index.ts";
import { Guard } from "../policy/guard.ts";
import { pathValuesOf } from "../policy/pathArgs.ts";
import type { DiskView } from "../types/disk.ts";
import { clip } from "../utils.ts";
import type { PreparedCall } from "./callRecord.ts";
import type { EngineEnv } from "./env.ts";
import { REAL_DISK } from "./postcondition.ts";

/** Prefijo de las claves de los hechos de artefactos. */
export const ARTIFACT_KEY_PREFIX = "artifact_";

/** Separador entre la ruta y el esbozo en el valor del hecho. */
export const ARTIFACT_SEPARATOR = " · ";

/** Texto máximo que se lee de un archivo para esbozarlo. */
const MAX_READ_BYTES = 256 * 1024;
/** Tope del valor del hecho (`BUDGET.factValueMax` es 500). */
const MAX_VALUE_CHARS = 480;
/** Rutas observadas por llamada. */
const MAX_PATHS_PER_CALL = 3;
const MAX_OUTLINE_ITEMS = 10;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

const kb = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

/** Huella corta y estable de una ruta (sin distinguir mayúsculas ni separadores), para la clave del hecho. */
export function artifactKey(file: string): string {
  const norm = file.trim().replace(/\\/g, "/").toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${ARTIFACT_KEY_PREFIX}${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** La ruta de un valor de hecho de artefacto. */
export const artifactPathOf = (value: string): string => {
  const at = value.indexOf(ARTIFACT_SEPARATOR);
  return at === -1 ? value : value.slice(0, at);
};

interface Heading {
  readonly level: number;
  readonly text: string;
  readonly first: string[];
  count: number;
}

/** Los encabezados de un texto, con sus primeras líneas de contenido (la primera vez que aparecen) y cuántas veces se repiten. */
function headingsOf(lines: readonly string[], firstLines: number): Heading[] {
  const out: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING.exec(lines[i]);
    if (m === null) continue;
    const title = `${m[1]} ${m[2]}`;
    const known = out.find((h) => h.text === title);
    if (known !== undefined) {
      known.count++;
      continue;
    }
    const first: string[] = [];
    for (let j = i + 1; j < lines.length && first.length < firstLines && HEADING.exec(lines[j]) === null; j++) {
      const t = lines[j].trim();
      if (t !== "") first.push(t.replace(/^[-*+]\s+/, ""));
    }
    out.push({ level: m[1].length, text: title, first, count: 1 });
  }
  return out;
}

const fallbackOutline = (lines: readonly string[]): string => {
  const nonEmpty = lines.map((l) => l.trim()).filter((l) => l !== "");
  if (nonEmpty.length === 0) return "empty";
  const end = nonEmpty.length > 1 ? `; ends: "${clip(nonEmpty[nonEmpty.length - 1], 80)}"` : "";
  return `Starts: "${clip(nonEmpty[0], 80)}"${end}`;
};

/**
 * Esbozo de un texto: tamaño y cantidad de líneas, y su estructura. Con encabezados, cada uno con su primera línea de contenido y `×N` si se repite; sin ellos, el comienzo
 * y el final. Dentro de `budget` caracteres: si no cabe, primero se acorta la línea de contenido y después se descartan los encabezados más profundos (las secciones
 * de arriba pesan más que los apartados), así que un documento largo no pierde sus últimas secciones.
 */
export function outlineOf(text: string, bytes: number, budget = 330): string {
  const lines = text.split(/\r?\n/);
  const head = `${kb(bytes)}, ${lines.length} lines`;
  const all = headingsOf(lines, 1);
  if (all.length === 0) {
    const body = fallbackOutline(lines);
    return body === "empty" ? `${head}, empty` : `${head}. ${body}`;
  }
  const render = (hs: readonly Heading[], firstChars: number): string =>
    hs.map((h) => `${clip(h.text, 40)}${h.count > 1 ? ` ×${h.count}` : ""}${firstChars === 0 || h.first.length === 0 ? "" : `: ${clip(h.first[0], firstChars)}`}`).join(" | ");
  let shown: readonly Heading[] = all;
  let firstChars = 50;
  for (;;) {
    if (shown.length <= MAX_OUTLINE_ITEMS && render(shown, firstChars).length <= budget) break;
    if (firstChars > 30) {
      firstChars = 30;
      continue;
    }
    const deepest = Math.max(...shown.map((h) => h.level));
    if (deepest > Math.min(...shown.map((h) => h.level))) {
      shown = shown.filter((h) => h.level < deepest);
      continue;
    }
    if (firstChars > 0) {
      firstChars = 0;
      continue;
    }
    shown = shown.slice(0, MAX_OUTLINE_ITEMS);
    break;
  }
  const more = shown.length < all.length ? ` | +${all.length - shown.length} more` : "";
  return `${head}. Outline: ${render(shown, firstChars)}${more}`;
}

/**
 * Lo que se le muestra al libro de requisitos del entregable, más completo que el esbozo del hecho (un modelo chico necesita ver contenido para separar «está» de «se
 * está buscando»): cada sección de primer nivel con hasta 3 líneas de contenido, repeticiones contadas. Se arma al momento de preguntar, con el archivo como está entonces.
 * Dentro de `budget` caracteres.
 */
export function sectionDigest(text: string, bytes: number, budget = 1800): string {
  const lines = text.split(/\r?\n/);
  const head = `${kb(bytes)}, ${lines.length} lines`;
  const all = headingsOf(lines, 3);
  if (all.length === 0) return `${head}. ${fallbackOutline(lines)}`;
  const top = Math.min(...all.map((h) => h.level));
  const sections = all.filter((h) => h.level <= top + 1);
  for (const perSection of [3, 2, 1, 0]) {
    const body = sections
      .map((h) => {
        const title = `${clip(h.text, 60)}${h.count > 1 ? ` (×${h.count})` : ""}`;
        const content = h.first.slice(0, perSection).map((l) => `    ${clip(l, 110)}`);
        return [title, ...content].join("\n");
      })
      .join("\n");
    if (body.length + head.length <= budget || perSection === 0) return `${head}\n${clip(body, budget)}`;
  }
  return head;
}

/** El valor del hecho de una ruta tal como está en el disco ahora, o `null` si no existe o no se puede mirar. */
export function observePath(file: string, disk: DiskView): string | null {
  if (!path.isAbsolute(file) || file.includes("{{") || file.includes("\0")) return null;
  try {
    if (!disk.exists(file)) return null;
    if (disk.isDirectory(file)) {
      const names = disk.list?.(file, 12);
      return names === undefined || names === null ? null : clip(`${file}${ARTIFACT_SEPARATOR}folder, ${names.length}${names.length >= 12 ? "+" : ""} entries: ${names.join(", ")}`, MAX_VALUE_CHARS);
    }
    const bytes = disk.size(file);
    const text = disk.readText?.(file, MAX_READ_BYTES);
    const body = text === undefined || text === null ? `${kb(bytes)}, not text or not readable` : outlineOf(text, bytes, Math.max(120, MAX_VALUE_CHARS - file.length - ARTIFACT_SEPARATOR.length - 45));
    return clip(`${file}${ARTIFACT_SEPARATOR}${body}`, MAX_VALUE_CHARS);
  } catch {
    return null;
  }
}

/** Operaciones del contexto con el estado observado de lo que dejó una escritura exitosa; vacío si no aplica. */
export function artifactFactOps(env: EngineEnv, call: PreparedCall): Op[] {
  const { ctx, deps } = env;
  if (call.kind !== "write") return [];
  const guard = Guard.evaluate(call.mcp, call.tool.name, call.resolved, deps.guardScope);
  if (guard.mandatory === true) return [];
  const disk = deps.disk ?? REAL_DISK;
  const seen = new Set<string>();
  const ops: Op[] = [];
  for (const file of pathValuesOf(call.resolved)) {
    if (ops.length >= MAX_PATHS_PER_CALL) break;
    const key = artifactKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    const value = observePath(file, disk);
    if (value !== null) {
      ops.push({ op: "set", target: `facts.${key}`, value: { value, stepId: call.stepId } });
    } else if (path.isAbsolute(file) && factExists(ctx, key)) {
      ops.push({ op: "set", target: `facts.${key}`, value: { value: null, stepId: call.stepId } }); // lo que se vigilaba ya no existe
    }
  }
  return ops;
}

function factExists(ctx: TaskContext, key: string): boolean {
  const element = ctx.get(`facts.${key}`);
  return element !== undefined && "value" in element && element.value !== null;
}

/** Los artefactos vigentes de la tarea, el más reciente primero: ruta y esbozo. */
export function artifactsOf(ctx: TaskContext): { readonly file: string; readonly value: string; readonly at: number }[] {
  const out: { file: string; value: string; at: number }[] = [];
  for (const [key, fact] of Object.entries(ctx.snapshot().facts)) {
    if (!key.startsWith(ARTIFACT_KEY_PREFIX) || fact.value === null) continue;
    out.push({ file: artifactPathOf(fact.value), value: fact.value, at: fact.at });
  }
  return out.sort((a, b) => b.at - a.at);
}
