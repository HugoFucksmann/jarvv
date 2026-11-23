/**
 * eval/variants/d5/d5_v02.ts
 *
 * Variante `mode: "prompt"` de `d5`.
 * Hipótesis: mantener la pregunta mínima de `prod` (medida contra falsos negativos en condicionales) y precisar solo
 * en `criteria` que pedidos condicionales ya verificados con resultado negativo cuentan como terminados mientras partes faltantes dan false.
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
        instructions: "Using only what DONE shows, is every part of REQUEST already done? False if any part is missing or was never done.",
        criteria: {
          true: "All requested parts and USER instructions are completed in DONE, or a conditional check showed no action was needed.",
          false: "Any requested action/file is missing from DONE, only copied instead of moved, or ended in an unresolved failure.",
        },
      },
    },
  };
}

const d5_v02: Variant = {
  name: "d5_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_v02;
