import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 5 - Variante B:
 * Choice binario ultra-nítido con instrucción de alto contraste semántico:
 * 'complete_solution' vs 'partial_attempt'.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      verdict: {
        type: "choice",
        instructions: "Assess whether DONE represents a complete solution to REQUEST.",
        criteria: {
          complete_solution: "DONE completely fulfills the user's request. All files, answers, and actions are finished.",
          partial_attempt: "DONE is only a partial attempt. It leaves unfulfilled parts, missing writes, or unperformed actions.",
        },
      },
    },
  };
}

const d5_it5_solution_vs_partial: Variant = {
  name: "d5_it5_solution_vs_partial",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const probs = answers.verdict?.probabilities ?? {};
      const pComplete = probs.complete_solution ?? 0;
      const pPartial = probs.partial_attempt ?? 0;

      return {
        complete: pComplete >= 0.52 && pComplete > pPartial,
        probability: pComplete,
      };
    },
  },
};

export default d5_it5_solution_vs_partial;

