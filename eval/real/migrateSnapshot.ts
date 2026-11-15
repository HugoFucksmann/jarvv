/**
 * eval/real/migrateSnapshot.ts
 *
 * Normaliza snapshots externos o de versiones previas fuera de `src/` antes de validarlos
 * con `parseSnapshot` / `create.fromSnapshot`.
 */

import { BUDGET } from "../../src/core/budget.ts";
import { CONTEXT_VERSION, create, parseSnapshot } from "../../src/core/ctx/index.ts";
import type { ContextData, ContextLimits, TaskContext } from "../../src/core/ctx/index.ts";
import { argsMax } from "../../src/core/tools/manifest.ts";

export const EVAL_CONTEXT_LIMITS: ContextLimits = {
  summaryMax: BUDGET.summaryMax,
  argsStringMax: argsMax(BUDGET.argsStringDefault),
  factValueMax: BUDGET.factValueMax,
  feedbackMax: BUDGET.feedbackMax,
  jsonMaxDepth: BUDGET.jsonMaxDepth,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Normaliza campos opcionales o legados de un snapshot antes de pasarlo a `parseSnapshot`.
 * No oculta snapshots con estructura rota o incompatible: `parseSnapshot` sigue validando todo.
 */
export function migrateSnapshot(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    throw new Error("migrateSnapshot: el snapshot debe ser un objeto JSON plano.");
  }

  const taskRaw = isRecord(raw.task) ? { ...raw.task } : raw.task;
  const task = isRecord(taskRaw)
    ? {
        ...taskRaw,
        stopReason: taskRaw.stopReason === undefined ? null : taskRaw.stopReason,
      }
    : taskRaw;

  const plans = Array.isArray(raw.plans)
    ? raw.plans.map((p) => (isRecord(p) ? { feedback: null, stepId: null, ...p } : p))
    : raw.plans ?? [];

  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((s) => (isRecord(s) ? { superseded: false, route: null, expected: null, planId: null, ...s } : s))
    : raw.steps ?? [];

  const calls = Array.isArray(raw.calls)
    ? raw.calls.map((c) =>
        isRecord(c)
          ? {
              verdict: null,
              reason: null,
              summary: null,
              ref: null,
              sig: null,
              ...c,
            }
          : c,
      )
    : raw.calls ?? [];

  const errors = Array.isArray(raw.errors) ? raw.errors : raw.errors ?? [];
  const refs = Array.isArray(raw.refs) ? raw.refs : raw.refs ?? [];
  const facts = isRecord(raw.facts) ? raw.facts : raw.facts ?? {};

  return {
    v: raw.v ?? CONTEXT_VERSION,
    task,
    plans,
    steps,
    calls,
    errors,
    facts,
    refs,
    result: raw.result === undefined ? null : raw.result,
  };
}

/** Valida un snapshot externo pasándolo por `migrateSnapshot` + `parseSnapshot`. */
export function parseMigratedSnapshot(raw: unknown): ContextData {
  return parseSnapshot(migrateSnapshot(raw), EVAL_CONTEXT_LIMITS);
}

/** Rehidrata un `TaskContext` vivo e invariante-válido desde un snapshot externo. */
export function rehydrateContext(raw: unknown, nowMs: () => number = () => Date.now()): TaskContext {
  return create.fromSnapshot(migrateSnapshot(raw), {
    ...EVAL_CONTEXT_LIMITS,
    now: nowMs,
  });
}
