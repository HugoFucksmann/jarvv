/**
 * `forPending` (sección 8.3): lo que necesita la consulta que mantiene la lista de pendientes del reactivo. La solicitud y la
 * lista anterior (parámetro: la guarda el motor), lo hecho con sus `args` y resumen, los últimos intentos no aprobados con su
 * razón (los fallos de pasos anteriores solo los ve esta vista) y la entrada del usuario.
 */

import { attemptCalls, doneCalls, lastN, recentWindowSize } from "../derive.ts";
import type { ContextData } from "../types.ts";
import { callViewOf, envViewsOf, failureViewOf, userInputViewsOf } from "./shared.ts";
import type { PendingView, WindowOptions } from "./types.ts";

export function buildPendingView(data: ContextData, previous: readonly string[], options: WindowOptions): PendingView {
  const size = recentWindowSize(data.steps, options.recentWindows);
  return {
    request: data.task.request,
    previous: [...previous],
    done: doneCalls(data.calls).map((c) => callViewOf(data, c, true)),
    attempts: lastN(attemptCalls(data.calls), size).map((c) => failureViewOf(data, c)),
    userInput: userInputViewsOf(data),
    env: envViewsOf(data),
  };
}
