import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 2 - Variante A:
 * Choice categórico con 3 opciones pero con umbral adaptado y sumando P(all_done) si domina sobre partial_work.
 * Si choice es 'all_done' y P(all_done) > P(partial_work) + 0.15, aprueba.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      status: {
        type: "choice",
        instructions: "Did DONE fulfill the user's REQUEST?",
        criteria: {
          all_done: "REQUEST is fulfilled. All required info was gathered or actions were completed.",
          partial_work: "Important parts of REQUEST were missed, or only partial prep was executed.",
          failed: "Calls failed or did not address the request.",
        },
      },
    },
  };
}

const d5_it2_choice_calibrated: Variant = {
  name: "d5_it2_choice_calibrated",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const probs = answers.status?.probabilities ?? {};
      const pAll = probs.all_done ?? 0;
      const pPartial = probs.partial_work ?? 0;

      // Si all_done es la opción ganadora con margen claro:
      const complete = pAll > 0.50 && pAll > pPartial;
      return {
        complete,
        probability: pAll,
      };
    },
  },
};

export default d5_it2_choice_calibrated;
