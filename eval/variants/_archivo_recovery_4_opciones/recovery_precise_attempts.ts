import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: 'recovery_targeted_rules' logró +14.8% passRate y 70.2% en recovery2, pero su debilidad estuvo
 * en que el modelo todavía confundía intentos >= 2 como reintentables. Si refinamos la opción rewrite_item
 * para que diga explícitamente "Only if this is the very first attempt (attempts = 1)", fortalecemos replan
 * con "Missing assumption in the plan" y preservamos la precisión de skip_continue y close.
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
        instructions:
          "Pick the recovery action matching attempts and dependency:",
        criteria: {
          rewrite_item:
            "The item failed only once (attempts: 1). Try this same goal again with corrected arguments, flags, or syntax.",
          replan:
            "A prerequisite step is missing before this one (a folder/file must be created or located first). Rebuild the plan.",
          skip_continue:
            "The item has failed repeatedly (attempts: 2+) or cannot be fixed, but the items after it do not need its result.",
          close:
            "The item has failed repeatedly (attempts: 2+), was denied, or cannot be fixed, and remaining items need its result, or Items after it is none.",
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

const recovery_precise_attempts: Variant = {
  name: "recovery_precise_attempts",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_precise_attempts;
