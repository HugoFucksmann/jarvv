/**
 * `forRoute` (sección 8.3): Decisión 1 y Decisión 2. En reactivo lleva la solicitud, lo hecho, el último resultado y los
 * intentos de la tarea; en deliberativo, el paso actual y los intentos de ese paso. En ambos, la entrada del usuario y los
 * hechos de entorno. Con `options.route` (Decisión 2) los intentos se filtran a la ruta elegida.
 */

import { attemptCalls, doneCalls, lastN, lastResultOf, recentWindowSize } from "../derive.ts";
import { currentOf } from "../query.ts";
import type { Call, ContextData } from "../types.ts";
import { callViewOf, envViewsOf, lineViewOf, stepViewOf, userInputViewsOf } from "./shared.ts";
import type { RouteView, RouteViewOptions } from "./types.ts";

export function buildRouteView(data: ContextData, options: RouteViewOptions): RouteView {
  const reactive = data.task.mode === "reactive";
  const size = recentWindowSize(data.steps, options.recentWindows);
  const step = reactive ? null : currentOf(data).step;

  // Reactivo: intentos de la tarea. Deliberativo: los del paso actual (ninguno si todavía no hay paso).
  let attempts: Call[];
  if (reactive) attempts = attemptCalls(data.calls);
  else attempts = step === null ? [] : attemptCalls(data.calls, step.id);
  if (options.route !== undefined) attempts = attempts.filter((c) => c.route === options.route);

  const last = reactive ? lastResultOf(data.calls) : null;
  return {
    request: reactive ? data.task.request : null,
    step: step === null ? null : stepViewOf(step),
    lastResult: last === null ? null : callViewOf(data, last, false),
    done: reactive ? doneCalls(data.calls).filter((c) => c.id !== last?.id).map(lineViewOf) : [],
    // El último intento lleva su resumen (el porqué del fallo); los anteriores, solo la línea `L`.
    attempts: lastN(attempts, size).map((c, i, all) => (i === all.length - 1 ? callViewOf(data, c, false) : lineViewOf(c))),
    userInput: userInputViewsOf(data),
    env: envViewsOf(data),
  };
}