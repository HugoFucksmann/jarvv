import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 3 - Variante A:
 * Perfeccionamiento de binary choice con foco en completitud vs pasos faltantes.
 * Criterios refinados para capturar tareas donde solo se leyeron datos pero faltaba escribir.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      completion_state: {
        type: "choice",
        instructions: "Determine whether the user's REQUEST has been completely satisfied by the actions in DONE.",
        criteria: {
          complete: "All requested operations, queries, or modifications are fulfilled in DONE.",
          incomplete: "Remaining steps needed, missing write/save action, or partial execution.",
        },
      },
    },
  };
}

const d5_it3_refined_binary: Variant = {
  name: "d5_it3_refined_binary",
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

export default d5_it3_refined_binary;
