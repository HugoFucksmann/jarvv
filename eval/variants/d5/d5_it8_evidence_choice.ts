import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 8 - Variante B:
 * Mismo núcleo pero redactado en términos de "sufficient evidence of completion":
 * 'complete' vs 'incomplete'.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      completion_state: {
        type: "choice",
        instructions: "Look at REQUEST and DONE. Is there sufficient evidence that the requested task was executed? (A copy does not count as a move).",
        criteria: {
          complete: "The task was executed and its goal achieved according to the completed calls in DONE.",
          incomplete: "The task was not achieved, a required action was missed, or an unperformed move/write is pending.",
        },
      },
    },
  };
}

const d5_it8_evidence_choice: Variant = {
  name: "d5_it8_evidence_choice",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const probs = answers.completion_state?.probabilities ?? {};
      const pComplete = probs.complete ?? 0;
      const pIncomplete = probs.incomplete ?? 0;

      return {
        complete: pComplete >= 0.50 && pComplete > pIncomplete,
        probability: pComplete,
      };
    },
  },
};

export default d5_it8_evidence_choice;

