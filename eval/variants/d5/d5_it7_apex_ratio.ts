import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 7 - Variante B:
 * Misma arquitectura que apex_choice pero con threshold dinámico:
 * Si P(completely_satisfied) >= 0.50 y ratio sobre unsatisfied > 1.15.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      completion_state: {
        type: "choice",
        instructions: "Determine whether the user's REQUEST is completely accomplished by the calls in DONE. Note: a copy does not fulfill a move. For conditionals, completing the matching branch is sufficient.",
        criteria: {
          completely_satisfied: "The user's goal, applicable condition, and all required changes are finished in DONE.",
          unsatisfied: "Unfinished work remains: missed action, unperformed write, or incomplete task.",
        },
      },
    },
  };
}

const d5_it7_apex_ratio: Variant = {
  name: "d5_it7_apex_ratio",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const probs = answers.completion_state?.probabilities ?? {};
      const pComplete = probs.completely_satisfied ?? 0;
      const pIncomplete = probs.unsatisfied ?? 0;

      return {
        complete: pComplete >= 0.50 && pComplete > pIncomplete * 1.1,
        probability: pComplete,
      };
    },
  },
};

export default d5_it7_apex_ratio;

