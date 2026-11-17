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
import type { Call, ContextData } from "../types.ts";
import {
  callViewOf,
  effectViewsOf,
  envViewsOf,
  failureViewOf,
  lineViewOf,
  recalledViewsOf,
  stepViewOf,
  taskPartsOf,
  userInputViewsOf,
} from "./shared.ts";
import type { ArgsView, ArgsViewOptions } from "./types.ts";

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

  const lastError = lastErrorOf(data.calls, options.tool, new Set(parts.failures.map((c) => c.id)));

  return {
    request: data.task.mode === "reactive" ? data.task.request : null,
    done: parts.done.map(lineViewOf),
    step: parts.step === null ? null : stepViewOf(parts.step),
    stepsDone: parts.stepsDone,
    lastReads: parts.reads.map((c) => callViewOf(c, true)),
    stepFailures: parts.failures.map((c) => failureViewOf(c)),
    lastError: lastError === null ? null : callViewOf(lastError, true),
    userInput: userInputViewsOf(data),
    env: envViewsOf(data),
    recalled: recalledViewsOf(data, options.recalled),
    effects: effectViewsOf(data),
  };
}