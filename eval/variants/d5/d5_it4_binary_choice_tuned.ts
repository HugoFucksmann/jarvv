import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 4 - Variante B:
 * Mismo formato que la ganadora `d5_it2_binary_choice`, pero optimizando el threshold
 * de aprobación a 0.52 para maximizar recall en casos borderline sin ceder especificidad.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      completion_state: {
        type: "choice",
        instructions: "Compare REQUEST with DONE. Is the task fully completed or still incomplete?",
        criteria: {
          complete: "Fully completed. All questions answered, files processed, or changes applied.",
          incomplete: "Incomplete. Missing actions, unperformed writes/saves, or unfinished parts.",
        },
      },
    },
  };
}

const d5_it4_binary_choice_tuned: Variant = {
  name: "d5_it4_binary_choice_tuned",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const probs = answers.completion_state?.probabilities ?? {};
      const pComplete = probs.complete ?? 0;
      const pIncomplete = probs.incomplete ?? 0;

      return {
        complete: pComplete >= 0.52 && pComplete > pIncomplete,
        probability: pComplete,
      };
    },
  },
};

export default d5_it4_binary_choice_tuned;

