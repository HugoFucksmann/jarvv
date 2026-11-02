/**
 * `forRoute` (sección 8): decisiones de ruta y herramienta. Paso actual y criterio, intentos recientes por ruta y
 * herramienta (cuáles fallaron), fallos recientes y hechos. En reactivo el paso no trae instrucción, así que la vista
 * incluye la solicitud.
 */

import { lastN, recentFailures, recentWindowSize } from "../derive.ts";
import { currentOf } from "../query.ts";
import type { ContextData } from "../types.ts";
import { attemptViewOf, factViewsOf, failureViewOf, stepViewOf } from "./shared.ts";
import type { RouteView, WindowOptions } from "./types.ts";

export function buildRouteView(data: ContextData, options: WindowOptions): RouteView {
  const size = recentWindowSize(data.steps, options.recentWindows);
  const step = currentOf(data).step;
  return {
    request: data.task.mode === "reactive" ? data.task.request : null,
    step: step === null ? null : stepViewOf(step),
    attempts: lastN(data.calls, size).map(attemptViewOf),
    failures: recentFailures(data.calls, size).map((c) => failureViewOf(data, c)),
    facts: factViewsOf(data),
  };
}
