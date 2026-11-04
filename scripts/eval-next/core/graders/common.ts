/**
 * scripts/eval-next/core/graders/common.ts
 *
 * Graders base aplicables a todas las etapas (parseo, truncado, latencia, etc.).
 */

import type { Grader, GraderCollector, GraderContext } from "../types.ts";

export function createCollector(): {
  collector: GraderCollector;
  metrics: Record<string, boolean>;
  measurements: Record<string, number | string>;
  errors: string[];
  warnings: string[];
  passed: boolean;
} {
  const metrics: Record<string, boolean> = {};
  const measurements: Record<string, number | string> = {};
  const errors: string[] = [];
  const warnings: string[] = [];

  const collector: GraderCollector = {
    check(key: string, ok: boolean, errorMessage: string): boolean {
      metrics[key] = ok;
      if (!ok) errors.push(errorMessage);
      return ok;
    },
    soft(key: string, ok: boolean, warningMessage: string): boolean {
      metrics[key] = ok;
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

export const NotTruncatedGrader: Grader<unknown, unknown> = {
  name: "not_truncated",
  grade(_output, _expect, ctx, col) {
    const isTruncated = ctx.finishReason === "length";
    col.check(
      "not_truncated",
      !isTruncated,
      "La salida fue truncada por límite de tokens (finish_reason=length)."
    );
  },
};

export const NonEmptyOutputGrader: Grader<unknown, unknown> = {
  name: "non_empty_output",
  grade(_output, _expect, ctx, col) {
    const trimmed = ctx.rawOutput.trim();
    col.check(
      "non_empty",
      trimmed.length > 0,
      "El modelo devolvió una respuesta vacía."
    );
  },
};

export const LatencyGrader: Grader<unknown, unknown> = {
  name: "latency",
  grade(_output, _expect, ctx, col) {
    col.measure("latency_ms", ctx.durationMs);
  },
};

