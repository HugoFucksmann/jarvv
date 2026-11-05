/**
 * eval/core/graders/common.ts
 *
 * Graders base y utilidades compartidas. `client_call_ok`, `variant_apply_ok` y `output_parse_ok`
 * los registra el runner (F4), no un grader.
 */

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
 */
export function containsTerm(haystack: string, needle: string): boolean {
  const h = norm(haystack);
  const n = norm(needle);
  if (n === "") return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?<!\\d[.,])${escapeRegExp(n)}(?![\\p{L}\\p{N}])(?![.,]\\d)`, "u").test(h);
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

/** Solo etapas generativas. */
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

export const LatencyGrader: Grader<unknown, unknown> = {
  name: "latency",
  grade(_output, _expect, ctx, col) {
    col.measure("latency_ms", ctx.durationMs);
  },
};
