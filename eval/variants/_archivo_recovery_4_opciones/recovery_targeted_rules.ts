import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: Aclarar la instrucción ("Select the recovery action based on fixability, prerequisite gaps, and remaining item dependency")
 * y contrastar 'rewrite_item' (un solo error de formato o argumento) con 'replan' (falta un paso previo de archivo/directorio)
 * y 'skip_continue' vs 'close' usando la dependencia directa del resultado.
 * Dataset: eval/datasets/recovery (recovery_casos, recovery2, recovery3)
 */
function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const behind =
    data.behind.length > 0
      ? data.behind.map((item, i) => `${i + 1}) ${safe(item)}`).join(" ")
      : "none";
  const cause = data.cause === null ? "unknown" : data.cause;

  const failedBlock = [
    "### THE STEP THAT JUST FAILED",
    `Item: ${safe(data.failed)}`,
    `Why it failed: ${cause}`,
    `Failed steps on this item so far: ${data.attempts}`,
    `Items after it: ${behind}`,
  ].join("\n");

  return {
    state: `${PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view })}\n\n${failedBlock}`,
    questions: {
      [RECOVERY_KEY]: {
        type: "choice",
        instructions: "Select the recovery action based on fixability, prerequisite gaps, and remaining item dependency.",
        criteria: {
          rewrite_item:
            "The item failed once (attempt 1) due to wrong tool arguments, bad format, or syntax. Retry the same goal with corrected call.",
          replan:
            "The failure indicates an unfulfilled prerequisite that must be executed first (create folder, locate file, install). Rebuild plan.",
          skip_continue:
            "The item cannot be completed (repeated failures or persistent refusal), but items after it do not depend on it. Proceed with next items.",
          close:
            "The item cannot be completed (repeated failures, blocked, or denied) and remaining items depend on it, or there are no items after it.",
        },
      },
      [RECOVERY_INDEPENDENT_KEY]: {
        type: "noul",
        instructions: "Can every item after the failed one be done without the result of the failed item?",
        criteria: {
          true: "None of the items after it needs the failed item's result, or there are no items after it.",
          false: "At least one of the items after it needs what the failed item was supposed to produce.",
        },
      },
    },
  };
}

const recovery_targeted_rules: Variant = {
  name: "recovery_targeted_rules",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_targeted_rules;
