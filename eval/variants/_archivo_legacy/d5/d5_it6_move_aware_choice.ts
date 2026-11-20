import type { CompletionDecisionInput } from "../../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import { PROMPTS } from "../../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../../core/variants/types.ts";

/**
 * Iteración 6 - Variante A:
 * Directamente ataca la trampa de 'Copy en vez de Move' (caso d5-cc-n05):
 * Choice con 'completely_satisfied' vs 'unsatisfied' con advertencia de que copiar no es mover.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      completion_state: {
        type: "choice",
        instructions: "Did DONE fulfill every part of REQUEST? Note: copying a file does not complete a request to move it.",
        criteria: {
          completely_satisfied: "All requested actions, writes, and file operations are completely finished.",
          unsatisfied: "Missing operations, unperformed moves (only copied), or unfinished steps.",
        },
      },
    },
  };
}

const d5_it6_move_aware_choice: Variant = {
  name: "d5_it6_move_aware_choice",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const probs = answers.completion_state?.probabilities ?? {};
      const pComplete = probs.completely_satisfied ?? 0;
      const pIncomplete = probs.unsatisfied ?? 0;

      return {
        complete: pComplete >= 0.52 && pComplete > pIncomplete,
        probability: pComplete,
      };
    },
  },
};

export default d5_it6_move_aware_choice;

