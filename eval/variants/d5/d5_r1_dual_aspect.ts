import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Ronda 1 - Variante A para D5:
 * Dos preguntas noul en lugar de una:
 * 1. `request_complete`: La pregunta clásica sobre REQUEST y DONE.
 * 2. `missing_action`: Pregunta inversa complementaria: ¿Hay algún archivo o cambio pedido que NO figure en DONE?
 * En `read` o decisión: confirma solo si `request_complete` es alto (>= 0.75) y `missing_action` es bajo (<= 0.40).
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      request_complete: {
        type: "noul",
        instructions: "Compare REQUEST against DONE. Was every requested action, target file, or query completely fulfilled?",
        criteria: {
          true: "Every part of REQUEST is fulfilled in DONE.",
          false: "Some part of REQUEST remains unfulfilled.",
        },
      },
      has_missing_action: {
        type: "noul",
        instructions: "Is there any requested file, command, or final result in REQUEST that was NOT executed or saved in DONE?",
        criteria: {
          true: "A requested file, edit, move, or result is completely missing from DONE.",
          false: "Nothing requested is missing from DONE.",
        },
      },
    },
  };
}

const d5_r1_dual_aspect: Variant = {
  name: "d5_r1_dual_aspect",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_r1_dual_aspect;
