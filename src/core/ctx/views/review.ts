/**
 * `forReview` (sección 8.3): Decisión 3, revisión de argumentos. Lo mismo que vio LLM 2 (`forArgs`), sin `refs` ni
 * `effects`: las refs sin resolver y el anti-loop se resuelven antes de forma determinista, y la seguridad de una escritura
 * es del Guard y de la confirmación del usuario. Las lecturas son las mismas que vio LLM 2, para contrastar los `args` con
 * los datos; la entrada del usuario sirve para decidir `info_missing`.
 *
 * Como esta vista no muestra efectos, las escrituras aprobadas aparecen en `done` (reactivo) como cualquier llamada hecha.
 */

import type { ContextData } from "../types.ts";
import { callViewOf, envViewsOf, failureViewOf, lineViewOf, stepViewOf, taskPartsOf, userInputViewsOf } from "./shared.ts";
import type { ReviewView, ReviewViewOptions } from "./types.ts";

export function buildReviewView(data: ContextData, options: ReviewViewOptions): ReviewView {
  const parts = taskPartsOf(data, options, []);
  return {
    done: parts.done.map(lineViewOf),
    step: parts.step === null ? null : stepViewOf(parts.step),
    stepsDone: parts.stepsDone,
    lastReads: parts.reads.map((c) => callViewOf(data, c, true)),
    stepFailures: parts.failures.map((c) => failureViewOf(data, c)),
    userInput: userInputViewsOf(data),
    env: envViewsOf(data),
  };
}
