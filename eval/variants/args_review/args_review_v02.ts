/**
 * eval/variants/args_review/args_review_v02.ts
 *
 * Variante `mode: "prompt"` de `args_review`.
 * Hipótesis: incluir `Recent reads` (`data.lastReads`) en el estado compacto de `prod` permite verificar si una ruta o recurso
 * propuesto fue visto en lecturas previas o si existe ambigüedad entre múltiples resultados antes de aprobar o rechazar.
 */

import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { ARGS_REVIEWS } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS, listBlock, REVIEW_OPTIONS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildArgsReview(data, { fullView: true });
  const q = base.questions.review;
  const c = data.candidate;
  const state = [
    data.step === null ? null : `Target: ${data.step.instruction}`,
    listBlock("User Input", data.userInput),
    listBlock("Recent reads", data.lastReads),
    listBlock("Previous Errors", data.stepFailures),
    `Call: ${c.route}/${c.tool}`,
    `Args: ${c.args}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions: q.instructions,
        criteria: Object.fromEntries(ARGS_REVIEWS.map((r) => [r, REVIEW_OPTIONS[r]])),
      },
    },
  };
}

const args_review_v02: Variant = {
  name: "args_review_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_v02;
