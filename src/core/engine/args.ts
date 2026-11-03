/**
 * JARVIS Core — Argumentos y etiquetas que prepara quien ejecuta antes de escribir en el contexto (Fase 5).
 *
 * - `clipWithin`: recorte con tope TOTAL (D23). `render/shared.clipMarked` conserva `max` caracteres y agrega el marcador
 *   encima, lo que sobrepasaría `ARGS_MAX` y el tope de un hecho (regla 7 de `apply`). Aquí el resultado nunca supera `cap`.
 * - `clipArgs`: recorte de los strings de `args` (5.2, D18): tope por defecto `BUDGET.argsStringDefault`, excepciones por
 *   parámetro del catálogo (`argCaps`), marcador `…(+N)`. Los tokens de ref completos (`{{ref:rN}}`, `ref:rN`) no se recortan.
 * - `computeSig`: huella de los argumentos YA resueltos (anti-loop). La calcula quien ejecuta (5.4).
 * - `callLabel` / `withLineCount`: `label` de una ref (D8): herramienta, argumento principal y líneas del archivo de la ref.
 */

import { createHash } from "node:crypto";

import { BUDGET } from "../budget.ts";
import type { JsonObject, JsonValue } from "../ctx/index.ts";
import { isWholeRefToken } from "../refs/refResolver.ts";
import { clipMarked, oneLine } from "../render/shared.ts";
import { argCapsOf } from "../tools/manifest.ts";
import { isRecord } from "../utils.ts";

// ───────────────────────── Recorte ─────────────────────────

const markerLength = (omitted: number): number => `…(+${omitted})`.length;

/** ¿Cortar en `keep` dejaría separado un par sustituto (la mitad de un carácter fuera del plano básico)? */
function splitsSurrogatePair(text: string, keep: number): boolean {
  if (keep <= 0 || keep >= text.length) return false;
  const code = text.charCodeAt(keep - 1);
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Recorta `text` para que, con el marcador `…(+N)` incluido, mida como máximo `cap` caracteres. Si ya cabe, lo devuelve
 * igual. Con un `cap` demasiado pequeño para el marcador, corta sin marcador (nunca supera `cap`).
 */
export function clipWithin(text: string, cap: number): string {
  if (text.length <= cap) return text;
  let keep = cap;
  while (keep > 0 && (keep + markerLength(text.length - keep) > cap || splitsSurrogatePair(text, keep))) keep -= 1;
  return keep > 0 ? clipMarked(text, keep) : text.slice(0, Math.max(cap, 0));
}

/**
 * Un contenedor (objeto o arreglo) a profundidad `d` es válido si `d < jsonMaxDepth`, con la raíz de `args` en 0 (`jsonProblem`
 * de ctx/json.ts, que es quien cuenta). Los que llegarían a `jsonMaxDepth` o más se reemplazan por `null`: sin margen de seguridad.
 */
const MAX_CONTAINER_DEPTH = BUDGET.jsonMaxDepth;

function clipValue(value: unknown, cap: number, depth: number): JsonValue {
  if (typeof value === "string") return isWholeRefToken(value) ? value : clipWithin(value, cap);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (depth >= MAX_CONTAINER_DEPTH) return null;
  if (Array.isArray(value)) return value.map((item) => clipValue(item, cap, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, clipValue(v, cap, depth + 1)] as [string, JsonValue]),
    );
  }
  return null;
}

/**
 * `args` tal como se escriben en la llamada: como los propuso el modelo (refs sin resolver), con los strings recortados.
 * El tope es el del parámetro de nivel superior (`argCaps` del catálogo o el valor por defecto) y lo heredan los
 * strings anidados.
 */
export function clipArgs(mcp: string, tool: string, args: Record<string, unknown>): JsonObject {
  const caps = argCapsOf(mcp, tool);
  return Object.fromEntries(
    Object.entries(args)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        const cap = Object.hasOwn(caps, key) ? caps[key] : BUDGET.argsStringDefault;
        return [key, clipValue(value, cap, 1)] as [string, JsonValue];
      }),
  );
}

// ───────────────────────── Huella (sig) ─────────────────────────

/** JSON canónico: claves ordenadas y sin `undefined`, para que dos argumentos iguales den la misma huella. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Huella (16 hex) de los argumentos resueltos. Se compara siempre junto con la herramienta (`ctx.isRepeat`). */
export function computeSig(resolvedArgs: Record<string, unknown>): string {
  return createHash("sha256").update(canonical(resolvedArgs)).digest("hex").slice(0, 16);
}

// ───────────────────────── Etiqueta de una ref ─────────────────────────

/** Argumentos que identifican el recurso de una llamada, en orden de preferencia. */
const LABEL_ARG_KEYS = ["path", "paths", "url", "urls", "query", "command", "pattern", "pid"] as const;

function labelArg(args: Record<string, unknown>): string | null {
  for (const key of LABEL_ARG_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      if (items.length > 0) return items.join(", ");
    }
  }
  return null;
}

/**
 * Líneas del texto, sin contar una línea vacía final (D8): `\r\n` y `\n` son un solo salto. Texto vacío = 0.
 * Es la cuenta del archivo de la ref, que es la que usa el modelo con `offset` y `length` (líneas).
 */
export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

/** `base (N líneas)`. */
export function withLineCount(base: string, text: string): string {
  const n = lineCount(text);
  return `${base} (${n} ${n === 1 ? "línea" : "líneas"})`;
}

/**
 * `label` de la ref de una llamada: `read_file /ruta (1240 líneas)`. `args` son los argumentos resueltos (o los
 * propuestos); el argumento principal se sanea y se recorta a `BUDGET.refLabelChars`. `fullText` es el texto de la ref.
 */
export function callLabel(tool: string, args: Record<string, unknown>, fullText: string): string {
  const main = labelArg(args);
  const head = main === null ? tool : `${tool} ${clipWithin(oneLine(main), BUDGET.refLabelChars)}`;
  return withLineCount(head, fullText);
}
