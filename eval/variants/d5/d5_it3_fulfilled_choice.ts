import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 3 - Variante B:
 * Choice binario pero estructurado con labels de acción clara: `fulfilled` vs `unfulfilled`.
 * Enfocado en si el estado final satisface la intención del usuario.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      completion_state: {
        type: "choice",
        instructions: "Evaluate the outcome shown in DONE against the user REQUEST.",
        criteria: {
          fulfilled: "Every part of the user's request is accomplished. No further work is needed.",
          unfulfilled: "The request is only partially done, a required action was missed, or results are incomplete.",
        },
      },
    },
  };
}

const d5_it3_fulfilled_choice: Variant = {
  name: "d5_it3_fulfilled_choice",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const probs = answers.completion_state?.probabilities ?? {};
      const pFulfilled = probs.fulfilled ?? 0;
      const pUnfulfilled = probs.unfulfilled ?? 0;

      return {
        complete: pFulfilled >= 0.52 && pFulfilled > pUnfulfilled,
        probability: pFulfilled,
      };
    },
  },
};

export default d5_it3_fulfilled_choice;
