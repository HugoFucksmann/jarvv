/**
 * eval/variants/d5/d5_v01.ts
 *
 * Variante `mode: "prompt"` de `d5`.
 * Hipótesis: agregar en `instructions` y `criteria` la verificación explícita de que todas las partes, restricciones
 * de USER y requisitos de mover (no solo copiar) estén presentes en DONE reduce falsos "sí" manteniendo formato corto.
 */

import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { COMPLETION_KEY } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      [COMPLETION_KEY]: {
        type: "noul",
        instructions:
          "Using only DONE and USER, is every part, target file, and constraint of REQUEST finished? Copy is not move; unrecovered FAIL or empty DONE means false.",
        criteria: {
          true: "Every requested item, destination, and constraint in REQUEST and USER is visibly finished in DONE.",
          false: "DONE is empty, a step/item/file from REQUEST is missing, a move only copied, or FAIL was not recovered.",
        },
      },
    },
  };
}

const d5_v01: Variant = {
  name: "d5_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_v01;
