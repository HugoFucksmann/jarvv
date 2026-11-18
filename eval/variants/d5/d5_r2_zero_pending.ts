import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Ronda 2 - Variante B para D5:
 * Formulación invertida / de confirmación neta con foco en si queda trabajo pendiente.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      request_complete: {
        type: "noul",
        instructions: "Is this task 100% finished, with zero pending actions left to satisfy REQUEST?",
        criteria: {
          true: "100% finished. No further tool call or action is needed.",
          false: "Incomplete. At least one requested action, output file, or subtask is still pending.",
        },
      },
    },
  };
}

const d5_r2_zero_pending: Variant = {
  name: "d5_r2_zero_pending",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_r2_zero_pending;
