import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 6 - Variante B:
 * Choice binario pero con foco en casos condicionales (casos d5-cc-y06, d5-cc-y07: "si no existe..."):
 * "When REQUEST is conditional (if X... else Y), fulfilling either branch completes the request."
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      completion_state: {
        type: "choice",
        instructions: "Compare REQUEST with DONE. Is the task finished according to the instructions? For conditional requests (if/else), fulfilling the matching branch completes the task.",
        criteria: {
          finished: "The task is finished. The applicable condition or all requested goals were fulfilled.",
          unfinished: "Still missing work, unperformed writes/moves, or unfinished actions.",
        },
      },
    },
  };
}

const d5_it6_conditional_aware: Variant = {
  name: "d5_it6_conditional_aware",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const probs = answers.completion_state?.probabilities ?? {};
      const pFinished = probs.finished ?? 0;
      const pUnfinished = probs.unfinished ?? 0;

      return {
        complete: pFinished >= 0.52 && pFinished > pUnfinished,
        probability: pFinished,
      };
    },
  },
};

export default d5_it6_conditional_aware;

