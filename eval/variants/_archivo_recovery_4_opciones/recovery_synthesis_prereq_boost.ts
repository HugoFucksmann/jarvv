import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis (Ronda 7):
 * Probamos mantener la estructura precisa de 'recovery_calibrated_synthesis' (que logró 66.4% global
 * y 91.4% en rewrite_item), pero reforzando la condición de replan para capturar los casos donde
 * el objetivo requiere pasos previos que no estaban en el plan:
 * "The failure shows that a missing prerequisite step must run first (for example a folder, file, package, or daemon that must be created, installed, or started). Rebuild plan."
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
    `Attempts so far: ${data.attempts}`,
    `Items after it: ${behind}`,
  ].join("\n");

  return {
    state: `${PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view })}\n\n${failedBlock}`,
    questions: {
      [RECOVERY_KEY]: {
        type: "choice",
        instructions:
          "Choose the recovery action based on the failure reason, attempts count, and pending items:",
        criteria: {
          rewrite_item:
            "First attempt (1 attempt) with a fixable command, parameter, format, or typo on this step. Retry.",
          replan:
            "The failure shows a missing prerequisite step must run first (create a missing folder/file, install package, or start service). Rebuild plan.",
          skip_continue:
            "The item cannot be completed (persistent error or refusal), but remaining items are unrelated tasks and do not need it. Continue.",
          close:
            "The item cannot be completed (persistent error, blocked, denied, or 2+ attempts) and remaining items depend on it, or no items remain. Stop.",
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

const recovery_synthesis_prereq_boost: Variant = {
  name: "recovery_synthesis_prereq_boost",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_synthesis_prereq_boost;
