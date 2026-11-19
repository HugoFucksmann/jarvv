import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis:
 * La etiqueta 'Attempts on this item' debe ser prominente y en el criterio de skip_continue
 * asociarse a "Persistent error on this item, but remaining items are unrelated".
 * En independent, contrastar "completely independent / unrelated to this failed item" vs "depends on it".
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
        instructions: "Choose what to do with the failed item and remaining plan:",
        criteria: {
          rewrite_item:
            "First failure (1 attempt) with fixable arguments, format, or syntax. Try the same item again.",
          replan:
            "A prerequisite step is missing before this one (need to create folder or locate file first). Rebuild plan.",
          skip_continue:
            "The item cannot be completed (persistent error or refusal), but remaining items are unrelated and do not need it. Continue.",
          close:
            "The item cannot be completed (persistent error, blocked, or denied) and remaining items depend on it, or no items remain. Stop.",
        },
      },
      [RECOVERY_INDEPENDENT_KEY]: {
        type: "noul",
        instructions: "Can the items after the failed one be executed independently without this item's result?",
        criteria: {
          true: "The next items do not need this item's result, or there are no items after it.",
          false: "At least one next item depends on what this failed item was supposed to produce.",
        },
      },
    },
  };
}

const recovery_unrelated_criteria: Variant = {
  name: "recovery_unrelated_criteria",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_unrelated_criteria;
