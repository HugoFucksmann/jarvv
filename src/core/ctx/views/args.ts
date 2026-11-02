/**
 * `forArgs` (sección 8): generación de argumentos. Liviana a propósito: sin ventana del plan. Instrucción del paso
 * con handoff (en reactivo, la solicitud y el historial), últimas lecturas con datos, refs disponibles (con lo ya
 * leído de cada una), efectos, hechos y fallos del paso actual (para no regenerar el mismo error de argumentos).
 */

import { handoffOf, lastN, lastReadsWithData, recentFailures, recentWindowSize } from "../derive.ts";
import { currentOf } from "../query.ts";
import type { ContextData, Ref } from "../types.ts";
import {
  attemptViewOf,
  callViewOf,
  effectViewsOf,
  factViewsOf,
  failureViewOf,
  refToView,
  refViewOf,
  stepViewOf,
} from "./shared.ts";
import type { ArgsView, ArgsViewOptions, AvailableRefView, HandoffView, ReadArgKeys, ShownRange } from "./types.ts";

/**
 * Tramos de una ref ya leídos: lecturas con datos cuyo `args[path]` es el `where` de la ref. Se devuelven los valores
 * crudos de `offset` y `length` (sin interpretar unidades).
 */
function shownRanges(data: ContextData, ref: Ref, keys: ReadArgKeys): ShownRange[] {
  const out: ShownRange[] = [];
  for (const call of data.calls) {
    if (call.kind !== "read" || call.status !== "ok" || call.args === null) continue;
    if (call.args[keys.path] !== ref.where) continue;
    const offset = call.args[keys.offset];
    const length = call.args[keys.length];
    out.push({
      callId: call.id,
      offset: typeof offset === "number" ? offset : null,
      length: typeof length === "number" ? length : null,
    });
  }
  return out;
}

export function buildArgsView(data: ContextData, options: ArgsViewOptions): ArgsView {
  const size = recentWindowSize(data.steps, options.recentWindows);
  const reactive = data.task.mode === "reactive";
  const step = currentOf(data).step;

  let handoff: HandoffView | null = null;
  if (!reactive) {
    const h = handoffOf(data);
    if (h !== null) handoff = { stepId: h.stepId, callId: h.callId, summary: h.summary, ref: refViewOf(data, h.ref) };
  }

  const refs: AvailableRefView[] = data.refs.map((ref) => ({
    ...refToView(ref),
    stepId: ref.stepId,
    shown: shownRanges(data, ref, options.readArgKeys),
  }));

  return {
    request: reactive ? data.task.request : null,
    step: step === null ? null : stepViewOf(step),
    handoff,
    history: reactive ? lastN(data.calls, size).map(attemptViewOf) : [],
    lastReads: lastReadsWithData(data.calls, size).map((c) => callViewOf(data, c, true)),
    refs,
    effects: effectViewsOf(data),
    facts: factViewsOf(data),
    stepFailures: step === null ? [] : recentFailures(data.calls, size, step.id).map((c) => failureViewOf(data, c)),
  };
}
