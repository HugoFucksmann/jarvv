/**
 * Piezas comunes de las vistas: conversión de elementos del contexto a su forma de vista. Solo lectura; no copian
 * texto ni lo recortan.
 */

import { effectsOf, isFailure, possibleEffectsOf } from "../derive.ts";
import { parseId } from "../ids.ts";
import type { Call, ContextData, Ref, Step } from "../types.ts";
import { ARGS_SHOWN_STATUSES, REASON_NOTES, STATUS_NOTES } from "./messages.ts";
import type { AttemptView, CallView, EffectView, FactView, RefView, StepView } from "./types.ts";

export function refToView(ref: Ref): RefView {
  return { id: ref.id, size: ref.size, where: ref.where, label: ref.label };
}

/** La ref con ese id, o `null` si `id` es `null` o no existe. */
export function refViewOf(data: ContextData, id: string | null): RefView | null {
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

/** `withArgs`: incluir los `args` (herramienta y lo que se quiso ejecutar). */
export function callViewOf(data: ContextData, call: Call, withArgs: boolean): CallView {
  return {
    id: call.id,
    stepId: call.stepId,
    route: call.route,
    tool: call.tool,
    kind: call.kind,
    status: call.status,
    verdict: call.verdict,
    reason: call.reason,
    statusNote: STATUS_NOTES[call.status],
    reasonNote: call.reason === null ? null : REASON_NOTES[call.reason],
    args: withArgs ? call.args : null,
    summary: call.summary,
    ref: refViewOf(data, call.ref),
  };
}

/** Un fallo muestra los `args` solo en `args_invalid`, `tool_rejected` e `info_missing` (sección 8). */
export function failureViewOf(data: ContextData, call: Call): CallView {
  return callViewOf(data, call, ARGS_SHOWN_STATUSES.includes(call.status));
}

export function attemptViewOf(call: Call): AttemptView {
  return {
    callId: call.id,
    stepId: call.stepId,
    route: call.route,
    tool: call.tool,
    status: call.status,
    verdict: call.verdict,
    failed: isFailure(call),
  };
}

/** Hechos vigentes (los retirados, con `value = null`, se omiten), del más antiguo al más reciente. */
export function factViewsOf(data: ContextData): FactView[] {
  const out: FactView[] = [];
  for (const key of Object.keys(data.facts)) {
    const fact = data.facts[key];
    if (fact.value !== null) out.push({ key, value: fact.value, stepId: fact.stepId, at: fact.at });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Todos los efectos, con sus `args` y sin recorte. */
export function effectViewsOf(data: ContextData): EffectView[] {
  return effectsOf(data.calls).map((c) => callViewOf(data, c, true));
}

/** Todos los posibles efectos, con sus `args` y sin recorte. */
export function possibleEffectViewsOf(data: ContextData): EffectView[] {
  return possibleEffectsOf(data.calls).map((c) => callViewOf(data, c, true));
}
