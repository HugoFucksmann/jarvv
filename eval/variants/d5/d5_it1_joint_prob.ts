import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 1 - Variante A:
 * Doble pregunta complementaria evaluada con reader `d5`:
 * 1. `request_complete`: ¿Cumple todo REQUEST?
 * 2. `has_remaining`: ¿Queda trabajo o archivo pendiente?
 * En `read`: la probabilidad de completar es P(complete) * (1 - P(remaining)).
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      request_complete: {
        type: "noul",
        instructions: "Did DONE achieve every requirement and output asked in REQUEST?",
        criteria: {
          true: "All required actions and outputs are accomplished in DONE.",
          false: "Some action, calculation or output file is missing.",
        },
      },
      has_remaining: {
        type: "noul",
        instructions: "Is there any unfulfilled goal, missing file, or incomplete action in REQUEST that still needs to be done?",
        criteria: {
          true: "At least one requested item or effect was not executed.",
          false: "Zero remaining tasks: everything requested is done.",
        },
      },
    },
  };
}

const d5_it1_joint_prob: Variant = {
  name: "d5_it1_joint_prob",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const pComplete = answers.request_complete?.noul ?? 0.5;
      const pRemaining = answers.has_remaining?.noul ?? 0.5;

      // La probabilidad combinada exige que complete sea alto Y remaining sea bajo
      const prob = pComplete * (1 - pRemaining * 0.7);
      return {
        complete: pComplete >= 0.70 && pRemaining <= 0.40,
        probability: prob,
      };
    },
  },
};

export default d5_it1_joint_prob;
