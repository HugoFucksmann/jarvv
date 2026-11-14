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
import { parseId } from "../ids.ts";
import { currentOf } from "../query.ts";
import type { Call, ContextData, Ref, Step } from "../types.ts";
import { ARGS_SHOWN_STATUSES, REASON_NOTES, STATE_NOTES, STOP_REASON_NOTES, statusNoteOf } from "./messages.ts";
import type { ArgsViewOptions, CallView, EffectView, FactView, RefView, StepDoneView, StepView, TaskView, UserInputView } from "./types.ts";

export function refToView(ref: Ref): RefView {
  return { id: ref.id, size: ref.size, where: ref.where, label: ref.label };
}

/** La ref con ese id, o `null` si `id` es `null` o no existe. */
function refViewOf(data: ContextData, id: string | null): RefView | null {
  if (id === null) return null;
  const parsed = parseId(id);
  if (parsed === null || parsed.section !== "refs") return null;
  const ref = data.refs[parsed.index];
  return ref !== undefined && ref.id === id ? refToView(ref) : null;
}

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
    statusNote: statusNoteOf(call.status, call.kind),
    reasonNote: call.reason === null ? null : REASON_NOTES[call.reason],
    failed: isFailure(call),
    args: null,
    summary: null,
    ref: null,
  };
}

/** `withArgs`: incluir los `args` (herramienta y lo que se quiso ejecutar). Siempre lleva `summary` y ref. */
export function callViewOf(data: ContextData, call: Call, withArgs: boolean): CallView {
  return {
    ...lineViewOf(call),
    args: withArgs ? call.args : null,
    summary: call.summary,
    ref: refViewOf(data, call.ref),
  };
}

/** Un fallo muestra los `args` solo en `args_invalid`, `tool_rejected` e `info_missing` (sección 8). */
export function failureViewOf(data: ContextData, call: Call): CallView {
  // Un `args_invalid` con razón escrita (pre-chequeo) no muestra los argumentos: la razón dice qué cambiar y, viéndolos, el modelo los copiaba.
  const hide = call.status === "args_invalid" && call.summary !== null;
  return callViewOf(data, call, ARGS_SHOWN_STATUSES.includes(call.status) && !hide);
}

/** Entrada del usuario (5.4), en orden cronológico. */
export function userInputViewsOf(data: ContextData): UserInputView[] {
  return userInputOf(data).map(({ kind, stepId, text }) => ({ kind, stepId, text }));
}

/** Hechos de entorno (5.4): los vigentes que no son respuestas del usuario. */
export function envViewsOf(data: ContextData): FactView[] {
  return envOf(data.facts).map(({ key, value, stepId, at }) => ({ key, value, stepId, at }));
}

/** Todos los efectos, con sus `args` y sin recorte. */
export function effectViewsOf(data: ContextData): EffectView[] {
  return effectsOf(data.calls).map((c) => callViewOf(data, c, true));
}

/** Todos los posibles efectos, con sus `args` y sin recorte. */
export function possibleEffectViewsOf(data: ContextData): EffectView[] {
  return possibleEffectsOf(data.calls).map((c) => callViewOf(data, c, true));
}

/** Ids de los efectos y posibles efectos: las vistas que los muestran aparte no repiten esas llamadas en otra sección. */
export function effectIdsOf(data: ContextData): Set<string> {
  return new Set<string>([...effectsOf(data.calls), ...possibleEffectsOf(data.calls)].map((c) => c.id));
}

// ───────────────────────── Partes comunes de `forArgs` ─────────────────────────

export interface TaskParts {
  /** Paso vigente en curso, si hay. */
  readonly step: Step | null;
  /** Reactivo: llamadas aprobadas no mostradas en otra sección. Deliberativo: vacío. */
  readonly done: Call[];
  /** Deliberativo: pasos completados; el resultado, si no se mostró ya en otra sección. Reactivo: vacío. */
  readonly stepsDone: StepDoneView[];
  readonly reads: Call[];
  readonly failures: Call[];
  /** Refs de las llamadas que muestran su ref (`excluded`, `reads` y `failures`): no se repiten en `refs`. */
  readonly shownRefs: ReadonlySet<string>;
}

/**
 * Piezas de `forArgs` (8.3). Una llamada aparece una sola vez, con este orden de prioridad:
 * `excluded` (efectos) > `reads` > `done` / `stepsDone` > `failures`.
 */
export function taskPartsOf(data: ContextData, options: Pick<ArgsViewOptions, "recentWindows" | "lastReads">, excluded: readonly Call[]): TaskParts {
  const reactive = data.task.mode === "reactive";
  const size = recentWindowSize(data.steps, options.recentWindows);
  const step = currentOf(data).step;

  const shown = new Set<string>();
  const shownRefs = new Set<string>();
  const mark = (call: Call): void => {
    shown.add(call.id);
    if (call.ref !== null) shownRefs.add(call.ref);
  };
  excluded.forEach(mark);

  const reads = lastReadsWithData(data.calls, options.lastReads).filter((c) => !shown.has(c.id));
  reads.forEach(mark);

  // `done` (reactivo): líneas `L`, sin ref: no marca refs porque no las muestra.
  const done = reactive ? doneCalls(data.calls).filter((c) => !shown.has(c.id)) : [];
  done.forEach((c) => shown.add(c.id));

  const stepsDone = reactive ? [] : stepsDoneViews(data, shown);

  const failures = step === null ? [] : recentFailures(data.calls, size, step.id).filter((c) => !shown.has(c.id));
  failures.forEach(mark);

  return { step, done, stepsDone, reads, failures, shownRefs };
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
    out.push({ id: s.id, instruction: s.instruction, outcome: free === null ? null : callViewOf(data, free, false) });
  }
  return out;
}

/** Estado de la tarea con su frase fija. */
export function taskViewOf(data: ContextData): TaskView {
  const { state, stopReason } = data.task;
  const note = stopReason === null ? STATE_NOTES[state] : `${STATE_NOTES[state]} ${STOP_REASON_NOTES[stopReason]}`;
  return { state, stopReason, note };
}