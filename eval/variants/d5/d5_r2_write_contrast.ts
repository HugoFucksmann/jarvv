import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Ronda 2 - Variante A para D5:
 * Instrucción focalizada en la comparación estricta de objetivos escritos vs leídos.
 * Aclarando explícitamente: si el pedido pide guardar/escribir/crear, tiene que haber un write_file/create/run_command que lo haga.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      request_complete: {
        type: "noul",
        instructions: "Look at REQUEST and DONE. Did DONE perform every write, save, calculation, or search asked? Reading input files does NOT complete a request that asks to save or write a result.",
        criteria: {
          true: "All required steps including writing, creating or computing results are present in DONE.",
          false: "Missing the final save/write action, or only partial steps were done.",
        },
      },
    },
  };
}

const d5_r2_write_contrast: Variant = {
  name: "d5_r2_write_contrast",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_r2_write_contrast;
