import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 5 - Variante A:
 * Doble pregunta choice acoplada:
 * 1. `main_goal`: 'achieved' vs 'missing'
 * 2. `unaccomplished_details`: 'none' vs 'has_missing_parts'
 * Exige que ambas preguntas coincidan en que no falta nada.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      main_goal: {
        type: "choice",
        instructions: "Did the actions in DONE achieve the core objective of REQUEST?",
        criteria: {
          achieved: "The main task requested by the user was successfully performed.",
          missing: "The core objective was not reached, failed, or only preparatory work was done.",
        },
      },
      remaining: {
        type: "choice",
        instructions: "Are there any secondary targets, saved files, or specific constraints of REQUEST that were left unfulfilled?",
        criteria: {
          none: "All details and sub-tasks are fully done. Nothing is left.",
          has_missing_parts: "At least one requested file, number, or action was omitted.",
        },
      },
    },
  };
}

const d5_it5_dual_choice: Variant = {
  name: "d5_it5_dual_choice",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const pAchieved = answers.main_goal?.probabilities?.achieved ?? 0;
      const pNone = answers.remaining?.probabilities?.none ?? 0;

      const complete = pAchieved >= 0.52 && pNone >= 0.50;
      const probability = (pAchieved + pNone) / 2;

      return {
        complete,
        probability,
      };
    },
  },
};

export default d5_it5_dual_choice;

