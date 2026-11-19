import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: Fusión de las dos mejores señales descubiertas:
 * 1) En 'action': Los criterios de 'recovery_targeted_rules' (precisión quirúrgica en 4 acciones)
 *    con la formulación de 'unrelated' para skip_continue (100% de precisión y hasta 75% recall).
 * 2) En 'independent': La pregunta de 'recovery_calibrated_indep' que logró el récord histórico
 *    de 89.7% y 88.2% de accuracy en dependencia, resolviendo el cuello de botella que tiraba abajo el passRate.
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

const recovery_synergy_leader: Variant = {
  name: "recovery_synergy_leader",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_synergy_leader;
