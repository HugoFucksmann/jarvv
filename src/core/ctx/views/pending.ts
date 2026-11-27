/**
 * `forPending` (sección 8.3): lo que necesita la consulta que mantiene la lista de pendientes del reactivo. La solicitud y la
 * lista anterior (parámetro: la guarda el motor), lo hecho con la instrucción del paso que lo cumplió, sus `args` y su resumen, los intentos no
 * aprobados desde lo último que salió bien (con su razón: los fallos de pasos anteriores solo los ve esta vista) y la entrada del usuario.
 */

import { attemptsSinceProgress, doneCalls, lastN, recentWindowSize } from "../derive.ts";
import type { ContextData } from "../types.ts";
import { callViewOf, envViewsOf, failureViewOf, userInputViewsOf } from "./shared.ts";
import type { PendingView, WindowOptions } from "./types.ts";

export function buildPendingView(data: ContextData, previous: readonly string[], options: WindowOptions): PendingView {
  const size = recentWindowSize(data.steps, options.recentWindows);
  const instructionOf = (stepId: string): string | null => data.steps.find((s) => s.id === stepId)?.instruction ?? null;
  return {
    request: data.task.request,
    previous: [...previous],
    done: doneCalls(data.calls).map((c) => ({ instruction: instructionOf(c.stepId), call: callViewOf(c, true) })),
    attempts: lastN(attemptsSinceProgress(data.calls), size).map((c) => ({ instruction: instructionOf(c.stepId), call: failureViewOf(c) })),
    userInput: userInputViewsOf(data),
    env: envViewsOf(data),
  };
}
