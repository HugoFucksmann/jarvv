import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis:
 * 1) En 'independent': La redacción actual "Can every item after the failed one be done without the result..."
 * sesga al 2B al conservadorismo extremo. Reformular a: "Are the remaining items separate and unblocked? True if they do not require this file or data."
 * 2) En 'action': Replan se fortalece para casos de "prerequisite/missing target", y rewrite_item se reserva estrictamente para error inicial de llamada.
 * Dataset: eval/datasets/recovery
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
            "A prerequisite step is missing before this one (like creating a directory, locating a file, or finding a path first). Rebuild plan.",
          skip_continue:
            "The item cannot be completed (repeated failures or persistent refusal), but items after it do not depend on it. Proceed with next items.",
          close:
            "The item cannot be completed (repeated failures, blocked, or denied) and remaining items depend on it, or there are no items after it.",
        },
      },
      [RECOVERY_INDEPENDENT_KEY]: {
        type: "noul",
        instructions:
          "Are the items after the failed one completely separate tasks that do not need its output?",
        criteria: {
          true: "The next items are independent tasks (or there are no items after it).",
          false: "At least one next item needs the data, file, or result of this failed item.",
        },
      },
    },
  };
}

const recovery_calibrated_indep: Variant = {
  name: "recovery_calibrated_indep",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_calibrated_indep;
