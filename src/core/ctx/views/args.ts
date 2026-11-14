/**
 * `forArgs` (sección 8.3): generación de argumentos. Lleva el paso actual; en reactivo suma lo hecho (líneas `L`) y en
 * deliberativo los pasos ya completados con su resultado. En ambos: las últimas lecturas aprobadas, las
 * refs más recientes que no se muestran en otra sección (con lo ya leído de cada una), los fallos del paso actual, la
 * entrada del usuario, los hechos de entorno y los efectos.
 *
 * Una llamada aparece una sola vez, con este orden de prioridad: `effects` > `lastReads` > `done` / `stepsDone` >
 * `stepFailures` (`taskPartsOf`). Sin handoff, sin hechos de usuario aparte ni historial: eso lo cubren `done`,
 * `stepsDone` y `userInput`.
 */

import { effectsOf, isApproved, isExecuted, isFailure } from "../derive.ts";
import type { Call, ContextData, Ref } from "../types.ts";
import {
  callViewOf,
  effectViewsOf,
  envViewsOf,
  failureViewOf,
  lineViewOf,
  refToView,
  stepViewOf,
  taskPartsOf,
  userInputViewsOf,
} from "./shared.ts";
import type { ArgsView, ArgsViewOptions, AvailableRefView, ReadArgKeys, ShownRange } from "./types.ts";

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

/**
 * El último intento ejecutado de `tool` que falló (error de la herramienta o resultado rechazado por la verificación), de
 * cualquier paso. Se corta en la primera llamada aprobada de esa herramienta (ya funcionó) y se omite si ya está en `skip`.
 * `denied` e `interrupted` no cuentan: no hay resultado que corregir.
 */
function lastErrorOf(calls: readonly Call[], tool: string | undefined, skip: ReadonlySet<string>): Call | null {
  if (tool === undefined) return null;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (c.tool !== tool) continue;
    if (isApproved(c)) return null;
    if (isExecuted(c) && c.status !== "denied" && c.status !== "interrupted" && isFailure(c)) return skip.has(c.id) ? null : c;
  }
  return null;
}

export function buildArgsView(data: ContextData, options: ArgsViewOptions): ArgsView {
  const parts = taskPartsOf(data, options, effectsOf(data.calls));

  const refs: AvailableRefView[] = data.refs
    .filter((ref) => !parts.shownRefs.has(ref.id))
    .slice(-Math.max(0, options.refs))
    .map((ref) => ({ ...refToView(ref), stepId: ref.stepId, shown: shownRanges(data, ref, options.readArgKeys) }));

  const lastError = lastErrorOf(data.calls, options.tool, new Set(parts.failures.map((c) => c.id)));

  return {
    request: data.task.mode === "reactive" ? data.task.request : null,
    done: parts.done.map(lineViewOf),
    step: parts.step === null ? null : stepViewOf(parts.step),
    stepsDone: parts.stepsDone,
    lastReads: parts.reads.map((c) => callViewOf(data, c, true)),
    refs,
    stepFailures: parts.failures.map((c) => failureViewOf(data, c)),
    lastError: lastError === null ? null : callViewOf(data, lastError, true),
    userInput: userInputViewsOf(data),
    env: envViewsOf(data),
    effects: effectViewsOf(data),
  };
}