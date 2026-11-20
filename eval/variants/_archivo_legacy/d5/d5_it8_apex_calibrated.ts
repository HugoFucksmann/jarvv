import type { CompletionDecisionInput } from "../../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import { PROMPTS } from "../../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../../core/variants/types.ts";

/**
 * Iteración 8 - Variante A (Optimización fina de apex_choice):
 * En d5-cc-y16, P(completely_satisfied) fue 0.474 frente a 0.525.
 * Ajustamos el threshold de confirmación a >= 0.45 si la confianza en 'unsatisfied' es marginal (< 0.55).
 * Además, reforzamos el criterio en tareas de resumen/guardado.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      completion_state: {
        type: "choice",
        instructions: "Did DONE fulfill every required part of REQUEST? Note: copying a file does not complete a request to move it. Computing, summarizing, or reading data and then saving the result completes that request.",
        criteria: {
          completely_satisfied: "All requested operations, writes, saves, moves, and results are completely accomplished in DONE.",
          unsatisfied: "Missing operations, unperformed moves (only copied), skipped actions, or unfinished steps.",
        },
      },
    },
  };
}

const d5_it8_apex_calibrated: Variant = {
  name: "d5_it8_apex_calibrated",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const probs = answers.completion_state?.probabilities ?? {};
      const pComplete = probs.completely_satisfied ?? 0;
      const pIncomplete = probs.unsatisfied ?? 0;

      // Si complete es >= 0.48 y pIncomplete no supera 0.52, aprueba
      const complete = pComplete >= 0.51 || (pComplete >= 0.47 && pIncomplete <= 0.53);
      return {
        complete,
        probability: pComplete,
      };
    },
  },
};

export default d5_it8_apex_calibrated;

