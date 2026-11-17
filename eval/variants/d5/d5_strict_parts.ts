import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { COMPLETION_KEY } from "../../core/contract.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Hipótesis: pedir explicitamente verificar todas las partes de REQUEST, el objeto/archivo exacto y el efecto final (lectura/copia no cuenta como escritura/movimiento si se pidió guardar o mover) reduce los falsos `sí` de D5 sin disparar falsos negativos si la redacción sigue siendo acotada.
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      [COMPLETION_KEY]: {
        type: "noul",
        instructions:
          "Compare REQUEST against DONE. True ONLY if every part, target file/item, and final effect requested in REQUEST is confirmed in DONE (reading or copying does not count if saving, editing or moving was asked).",
        criteria: {
          true: "Every requested part, target, and action is confirmed in DONE.",
          false: "Any requested part, target, value, or write/move/change is missing from DONE.",
        },
      },
    },
  };
}

const d5_strict_parts: Variant = {
  name: "d5_strict_parts",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_strict_parts;
