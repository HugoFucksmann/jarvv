import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Ronda 3 - Variante B para D5:
 * Estructura de pregunta enfocada en "DONE accomplishes REQUEST",
 * con criterio estricto sobre pedidos de dos o más partes.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      request_complete: {
        type: "noul",
        instructions: "Using exclusively the calls and outputs in DONE, are all goals and constraints of REQUEST fully achieved? If the request contains multiple goals (e.g. read AND save, or check AND write), return True ONLY if every single goal was executed.",
        criteria: {
          true: "Every single goal and action in REQUEST is completed in DONE.",
          false: "Any goal was missed, partial, or left pending.",
        },
      },
    },
  };
}

const d5_r3_multigoal_strict: Variant = {
  name: "d5_r3_multigoal_strict",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_r3_multigoal_strict;
