import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { COMPLETION_KEY } from "../../core/contract.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

// Hipótesis: una pregunta mínima sin criterios repetidos ni condicionales reduce ruido en el modelo 2B y evita falsos negativos en pedidos simples ya resueltos por DONE.
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      [COMPLETION_KEY]: {
        type: "noul",
        instructions: "Does DONE complete everything asked in REQUEST?",
      },
    },
  };
}

const d5_ultra_brief: Variant = {
  name: "d5_ultra_brief",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_ultra_brief;
