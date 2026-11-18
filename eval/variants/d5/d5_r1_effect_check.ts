import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Ronda 1 - Variante B para D5:
 * Redacción enfocada en las acciones de efecto (crear/guardar/mover/editar) vs lectura pasiva.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      request_complete: {
        type: "noul",
        instructions: "Did DONE achieve the user's intended end result? If REQUEST asked to save, write, move, or change something, did a completed call actually perform that change (reading or listing alone is not enough)?",
        criteria: {
          true: "The final intended outcome and all requested changes are present in DONE.",
          false: "The task stopped early, only read or listed without changing, or missed an action.",
        },
      },
    },
  };
}

const d5_r1_effect_check: Variant = {
  name: "d5_r1_effect_check",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_r1_effect_check;
