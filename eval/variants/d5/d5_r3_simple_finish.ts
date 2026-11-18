import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Ronda 3 - Variante A para D5:
 * Formato de checklist con 2 preguntas concretas:
 * 1. `request_complete`: La pregunta estándar.
 * 2. `targets_exist`: ¿Cada archivo o resultado pedido existe en DONE?
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      request_complete: {
        type: "noul",
        instructions: "Did the assistant finish all user requirements in REQUEST according to DONE?",
        criteria: {
          true: "All required actions and targets are finished.",
          false: "Some requested action or target was skipped or omitted.",
        },
      },
    },
  };
}

const d5_r3_simple_finish: Variant = {
  name: "d5_r3_simple_finish",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_r3_simple_finish;
