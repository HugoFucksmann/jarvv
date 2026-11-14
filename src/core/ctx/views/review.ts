/**
 * `forReview` (sección 8.3): Decisión 3, revisión de argumentos. Solo expone el paso actual, los fallos recientes del paso y
 * la entrada del usuario (para decidir `info_missing`); las lecturas, lo hecho, el entorno, `refs` y `effects` no los usa
 * esta etapa.
 */

import { recentFailures, recentWindowSize } from "../derive.ts";
import { currentOf } from "../query.ts";
import type { ContextData } from "../types.ts";
import { failureViewOf, stepViewOf, userInputViewsOf } from "./shared.ts";
import type { ReviewView, ReviewViewOptions } from "./types.ts";

export function buildReviewView(data: ContextData, options: ReviewViewOptions): ReviewView {
  const step = currentOf(data).step;
  const size = recentWindowSize(data.steps, options.recentWindows);
  const failures = step === null ? [] : recentFailures(data.calls, size, step.id);
  return {
    step: step === null ? null : stepViewOf(step),
    stepFailures: failures.map((c) => failureViewOf(data, c)),
    userInput: userInputViewsOf(data),
  };
}
