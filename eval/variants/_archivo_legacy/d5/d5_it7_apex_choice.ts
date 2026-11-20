import type { CompletionDecisionInput } from "../../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import { PROMPTS } from "../../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../../core/variants/types.ts";

/**
 * Iteración 7 - Variante A:
 * La evolución combinada de it6:
 * Une la cláusula de Copy vs Move (que destrabó d5-cc-n05) con la cláusula condicional de if/else
 * en un choice binario de alto contraste: `completely_satisfied` vs `unsatisfied`.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      completion_state: {
        type: "choice",
        instructions: "Did DONE fulfill every required part of REQUEST? Note: copying a file does not complete a request to move it. For conditional requests (if/else), fulfilling the applicable branch satisfies the request.",
        criteria: {
          completely_satisfied: "All requested operations, writes, moves, and applicable branches are completely finished in DONE.",
          unsatisfied: "Missing operations, unperformed moves (only copied), skipped branch, or unfinished steps.",
        },
      },
    },
  };
}

const d5_it7_apex_choice: Variant = {
  name: "d5_it7_apex_choice",
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

export default d5_it7_apex_choice;

