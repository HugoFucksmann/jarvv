import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { COMPLETION_KEY } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * d5_noul_calibrated
 * Hipótesis: En d5 (cierre reactivo), mantener exactamente la instrucción de producción pero
 * agregar criterios noul true/false simétricos sin añadir tokens redundantes, para que d3:2b
 * no dude en aprobaciones completas legítimas.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      [COMPLETION_KEY]: {
        type: "noul",
        instructions:
          "Using only what DONE shows, is every part of REQUEST already done? False if any part is missing or was never done.",
        criteria: {
          true: "All parts of REQUEST are fully satisfied by the completed tasks shown in DONE.",
          false: "Any requested item, file, search, or part of REQUEST remains unfulfilled.",
        },
      },
    },
  };
}

const d5_noul_calibrated: Variant = {
  name: "d5_noul_calibrated",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_noul_calibrated;
