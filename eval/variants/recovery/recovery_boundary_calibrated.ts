import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * recovery_boundary_calibrated
 * Hipótesis: En recovery (recovery3: 6 replan predichos como rewrite_item y 5 close como rewrite_item),
 * d3:2b sobre-apuesta a rewrite_item. Al clarificar nítidamente que cuando falta un prerrequisito
 * o herramienta previa no se debe reintentar (replan), y que ante fallos irreversibles/bloqueos se debe cerrar (close),
 * se balancea la distribución reduciendo falsos rewrite_item.
 */
function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const cause = data.cause === null ? "unknown" : data.cause;
  const failedBlock = [
    "### THE STEP THAT JUST FAILED",
    `Item: ${safe(data.failed)}`,
    `Why it failed: ${cause}`,
    `Attempts so far: ${data.attempts}`,
    "Items after it: none",
  ].join("\n");

  return {
    state: `${PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view })}\n\n${failedBlock}`,
    questions: {
      [RECOVERY_KEY]: {
        type: "choice",
        instructions: "Select the single correct recovery action based on the failure cause and attempts:",
        criteria: {
          rewrite_item:
            "First attempt (1 attempt) where the step itself can succeed by fixing command syntax, path, or arguments.",
          replan:
            "A prerequisite step is missing first (such as creating a directory, installing a package, or freeing a port).",
          close:
            "The goal cannot be achieved (impossible task, app does not exist, tests fail, repeated failures 2+, or denied).",
        },
      },
    },
  };
}

const recovery_boundary_calibrated: Variant = {
  name: "recovery_boundary_calibrated",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_boundary_calibrated;
