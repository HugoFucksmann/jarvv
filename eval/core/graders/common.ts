/**
 * eval/core/graders/common.ts
 *
 * Graders base y utilidades compartidas. `client_call_ok` y `output_parse_ok`
 * los registra el runner (F4), no un grader.
 */

import { CALL_STATUSES, SYSTEM_TOOL_MANIFEST, VERDICT_REASONS } from "../contract.ts";
import type { Grader, GraderCollector } from "../types.ts";

/** Normalización de texto: NFD sin diacríticos, minúsculas, espacios colapsados, trim. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ¿`haystack` contiene `needle` como palabra/frase completa? Ambos se normalizan con `norm`.
 * Evita falsos positivos de subcadena ("12" en "120", "rm" en "confirmar"). Los límites son
 * "no hay letra o dígito pegado" a cada lado, así que `README.md` o `src/a.ts` siguen funcionando.
 * Tampoco coincide dentro de un número mayor con separador decimal o de miles: "12" no está en "12.5",
 * "12,5", "12.000" ni "1.12".
 * Un término puede traer alternativas separadas por `|` (`archivo|archivos`): basta con que coincida una.
 */
export function containsTerm(haystack: string, needle: string): boolean {
  // Alternativas: `archivo|archivos` coincide con cualquiera de las dos (`\|` es un `|` literal).
  const parts = needle.split(/(?<!\\)\|/);
  if (parts.length > 1) return parts.some((p) => containsTerm(haystack, p));
  needle = needle.replace(/\\\|/g, "|");
  const h = norm(haystack);
  const n = norm(needle);
  if (n === "") return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?<!\\d[.,])${escapeRegExp(n)}(?![\\p{L}\\p{N}])(?![.,]\\d)`, "u").test(h);
}

/**
 * Términos internos que los prompts de producción prohíben mostrar al usuario: nombres de herramientas, estados de llamada, razones del verificador
 * (todos con guion bajo, así que no chocan con palabras comunes ni con nombres de carpetas del usuario) e ids de llamadas, pasos y resultados.
 */
const INTERNAL_TERMS: readonly string[] = [...new Set([...SYSTEM_TOOL_MANIFEST.map((t) => t.name), ...CALL_STATUSES, ...VERDICT_REASONS].filter((w) => w.includes("_")))];
// Un id suelto (`c1`, «el paso s2»). No cuenta si es parte de un nombre de archivo o de una ruta del usuario (`c1.csv`, `datos/r2/`, `a-s3`).
const INTERNAL_ID_RE = /(?<![\w./\\-])[csr]\d+(?![\w/\\-]|\.\w)/;

/** El primer término interno (herramienta, estado, razón o id `c1`/`s2`/`r3`) que aparece en `text`, o undefined. */
export function findInternalLeak(text: string): string | undefined {
  return INTERNAL_ID_RE.exec(text)?.[0] ?? INTERNAL_TERMS.find((term) => containsTerm(text, term));
}

export function createCollector(): {
  collector: GraderCollector;
  metrics: Record<string, boolean>;
  measurements: Record<string, number | string>;
  errors: string[];
  warnings: string[];
  /** Ojo: es un getter. No desestructurar (se evalúa una sola vez); leer `errors.length === 0` o `c.passed`. */
  readonly passed: boolean;
} {
  const metrics: Record<string, boolean> = {};
  const measurements: Record<string, number | string> = {};
  const errors: string[] = [];
  const warnings: string[] = [];

  // Métrica "pegajosa": una vez en false, un `true` posterior con la misma clave no la borra.
  const record = (key: string, ok: boolean): void => {
    metrics[key] = (metrics[key] ?? true) && ok;
  };

  const collector: GraderCollector = {
    check(key: string, ok: boolean, errorMessage: string): boolean {
      record(key, ok);
      if (!ok) errors.push(errorMessage);
      return ok;
    },
    soft(key: string, ok: boolean, warningMessage: string): boolean {
      record(key, ok);
      if (!ok) warnings.push(warningMessage);
      return ok;
    },
    measure(key: string, value: number | string): void {
      measurements[key] = value;
    },
  };

  return {
    collector,
    metrics,
    measurements,
    errors,
    warnings,
    get passed() {
      return errors.length === 0;
    },
  };
}

/**
 * Solo etapas generativas que producción rechaza si la salida quedó cortada (`rejectTruncated: true`: `plan`, `arguments` y `pending`, cuyo JSON
 * truncado es inválido). Una salida cortada es un fallo del run, como lo es para el motor.
 */
export const NotTruncatedGrader: Grader<unknown, unknown> = {
  name: "not_truncated",
  grade(_output, _expect, ctx, col) {
    col.check(
      "not_truncated",
      ctx.finishReason !== "length",
      "La salida fue truncada por límite de tokens (finish_reason=length).",
    );
  },
};

/**
 * Etapas de texto libre (`final`, `question`): producción pide un reintento si la salida quedó cortada, pero en el último intento la acepta
 * (`final` le agrega un aviso). El run no falla; la clave `not_truncated` queda en falso y se avisa, para ver cuánto texto sale cortado.
 */
export const TruncationNoteGrader: Grader<unknown, unknown> = {
  name: "truncation_note",
  grade(_output, _expect, ctx, col) {
    col.soft(
      "not_truncated",
      ctx.finishReason !== "length",
      "La salida quedó cortada por el límite de tokens (finish_reason=length): producción la acepta en el último intento, pero el texto está incompleto.",
    );
  },
};

export const LatencyGrader: Grader<unknown, unknown> = {
  name: "latency",
  grade(_output, _expect, ctx, col) {
    col.measure("latency_ms", ctx.durationMs);
  },
};
