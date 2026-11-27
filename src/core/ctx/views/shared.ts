/**
 * Piezas comunes de las vistas: conversión de elementos del contexto a su forma de vista. Solo lectura; no copian
 * texto ni lo recortan.
 */

import {
  doneCalls,
  effectsOf,
  envOf,
  isFailure,
  lastReadsWithData,
  outcomeOf,
  possibleEffectsOf,
  recentFailures,
  recentWindowSize,
  userInputOf,
} from "../derive.ts";
import { currentOf } from "../query.ts";
import type { Call, ContextData, RecalledSource, Step } from "../types.ts";
import { ARGS_SHOWN_STATUSES } from "./messages.ts";
import type {
  CallView,
  EffectView,
  FactView,
  RecalledFilterOptions,
  RecalledView,
  ReviewViewOptions,
  StepDoneView,
  StepView,
  TaskView,
  UserInputView,
} from "./types.ts";

export function stepViewOf(step: Step): StepView {
  return {
    id: step.id,
    state: step.state,
    superseded: step.superseded,
    instruction: step.instruction,
    route: step.route,
    expected: step.expected,
  };
}

/** Línea de llamada `L` (8.2): identificación y resultado fijo, sin `args`, `summary` ni ref. */
export function lineViewOf(call: Call): CallView {
  return {
    id: call.id,
    stepId: call.stepId,
    route: call.route,
    tool: call.tool,
    kind: call.kind,
    status: call.status,
    verdict: call.verdict,
    reason: call.reason,
    failed: isFailure(call),
    args: null,
    summary: null,
  };
}

/** `withArgs`: incluir los `args` (herramienta y lo que se quiso ejecutar). Siempre lleva `summary`; nunca la ref (los modelos no las ven). */
export function callViewOf(call: Call, withArgs: boolean): CallView {
  return {
    ...lineViewOf(call),
    args: withArgs ? call.args : null,
    summary: call.summary,
  };
}

/** Un fallo muestra los `args` solo en `args_invalid`, `tool_rejected` e `info_missing` (sección 8). */
export function failureViewOf(call: Call): CallView {
  // Un `args_invalid` con razón escrita (pre-chequeo) no muestra los argumentos: la razón dice qué cambiar y, viéndolos, el modelo los copiaba.
  const hide = call.status === "args_invalid" && call.summary !== null;
  return callViewOf(call, ARGS_SHOWN_STATUSES.includes(call.status) && !hide);
}

/** Entrada del usuario (5.4), en orden cronológico. */
export function userInputViewsOf(data: ContextData): UserInputView[] {
  return userInputOf(data).map(({ kind, stepId, text }) => ({ kind, stepId, text }));
}

/** Hechos de entorno (5.4): los vigentes que no son respuestas del usuario. */
export function envViewsOf(data: ContextData): FactView[] {
  return envOf(data.facts).map(({ key, value, stepId, at }) => ({ key, value, stepId, at }));
}

/** Aportes de `recalled` filtrados por política de fuentes y topes por vista, conservando el orden cronológico. */
export function recalledViewsOf(data: ContextData, filter?: RecalledFilterOptions): RecalledView[] {
  const sources = filter?.sources;
  const entries = sources ? data.recalled.filter((r) => sources.includes(r.source)) : data.recalled;
  if (entries.length === 0) return [];

  const maxBySource = filter?.maxBySource;
  if (!maxBySource) {
    return entries.map(({ id, at, stepId, source, key, value, from }) => ({ id, at, stepId, source, key, value, from }));
  }

  const counts = new Map<RecalledSource, number>();
  for (const r of entries) counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
  const skip = new Map<RecalledSource, number>();
  for (const [source, total] of counts) {
    const cap = maxBySource[source];
    if (cap !== undefined && total > cap) skip.set(source, total - Math.max(0, cap));
  }

  const seen = new Map<RecalledSource, number>();
  const out: RecalledView[] = [];
  for (const r of entries) {
    const idx = seen.get(r.source) ?? 0;
    seen.set(r.source, idx + 1);
    if (idx < (skip.get(r.source) ?? 0)) continue;
    out.push({ id: r.id, at: r.at, stepId: r.stepId, source: r.source, key: r.key, value: r.value, from: r.from });
  }
  return out;
}

/** Todos los efectos, con sus `args` y sin recorte. */
export function effectViewsOf(data: ContextData): EffectView[] {
  return effectsOf(data.calls).map((c) => callViewOf(c, true));
}

/** Todos los posibles efectos, con sus `args` y sin recorte. */
export function possibleEffectViewsOf(data: ContextData): EffectView[] {
  return possibleEffectsOf(data.calls).map((c) => callViewOf(c, true));
}

/** Ids de los efectos y posibles efectos: las vistas que los muestran aparte no repiten esas llamadas en otra sección. */
export function effectIdsOf(data: ContextData): Set<string> {
  return new Set<string>([...effectsOf(data.calls), ...possibleEffectsOf(data.calls)].map((c) => c.id));
}

// ───────────────────────── Partes comunes de `forArgs` y `forReview` ─────────────────────────

interface TaskParts {
  /** Paso vigente en curso, si hay. */
  readonly step: Step | null;
  /** Reactivo: llamadas aprobadas no mostradas en otra sección. Deliberativo: vacío. */
  readonly done: Call[];
  /** Deliberativo: pasos completados; el resultado, si no se mostró ya en otra sección. Reactivo: vacío. */
  readonly stepsDone: StepDoneView[];
  readonly reads: Call[];
  readonly failures: Call[];
}

/**
 * Lo que `forArgs` y `forReview` comparten (8.3). Una llamada aparece una sola vez, con este orden de prioridad:
 * `excluded` (efectos, donde la vista los muestra) > `reads` > `done` / `stepsDone` > `failures`.
 */
export function taskPartsOf(data: ContextData, options: ReviewViewOptions, excluded: readonly Call[]): TaskParts {
  const reactive = data.task.mode === "reactive";
  const size = recentWindowSize(data.steps, options.recentWindows);
  const step = currentOf(data).step;

  const shown = new Set<string>();
  const mark = (call: Call): void => {
    shown.add(call.id);
  };
  excluded.forEach(mark);

  const chosen = options.readIds === undefined ? null : new Set(options.readIds);
  const candidates = chosen === null ? lastReadsWithData(data.calls, options.lastReads) : lastReadsWithData(data.calls, data.calls.length).filter((c) => chosen.has(c.id));
  const reads = candidates.filter((c) => !shown.has(c.id));
  reads.forEach(mark);

  // `done` (reactivo): líneas `L`.
  const done = reactive ? doneCalls(data.calls).filter((c) => !shown.has(c.id)) : [];
  for (const c of done) shown.add(c.id);

  const stepsDone = reactive ? [] : stepsDoneViews(data, shown);

  const failures = step === null ? [] : recentFailures(data.calls, size, step.id).filter((c) => !shown.has(c.id));
  failures.forEach(mark);

  return { step, done, stepsDone, reads, failures };
}

/**
 * Pasos `completed` vigentes con su resultado (`outcome`, 5.4). El resultado se omite si esa llamada ya se mostró en otra
 * sección (`shown`); si no, queda registrado en `shown`.
 */
export function stepsDoneViews(data: ContextData, shown: Set<string>): StepDoneView[] {
  const out: StepDoneView[] = [];
  for (const s of data.steps) {
    if (s.superseded || s.state !== "completed") continue;
    const outcome = outcomeOf(data.calls, s.id);
    const free = outcome !== null && !shown.has(outcome.id) ? outcome : null;
    if (free !== null) shown.add(free.id);
    out.push({ id: s.id, instruction: s.instruction, outcome: free === null ? null : callViewOf(free, false) });
  }
  return out;
}

/** Estado de la tarea y su motivo de detención, tal cual. */
export function taskViewOf(data: ContextData): TaskView {
  const { state, stopReason } = data.task;
  return { state, stopReason };
}