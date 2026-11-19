import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: La causa directa del fallo y la lista de ítems restantes deben guiar la instrucción:
 * "Decide next action using failure cause, attempts count, and remaining items list:"
 * En replan: "The goal requires a missing dependency that must be created or searched before running this step."
 * En rewrite_item: "First attempt: retry this item with corrected arguments or syntax."
 * En skip_continue: "Unfixable item, but items after it are independent tasks and should be executed."
 * En close: "Unfixable item and remaining items depend on it, or no items after it."
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
          "Decide next action using failure cause, attempts count, and remaining items list:",
        criteria: {
          rewrite_item:
            "First failure (1 attempt) with fixable arguments, format, or syntax. Try the same item again.",
          replan:
            "The goal requires a missing prerequisite (folder, file, or path) that must be created or searched first.",
          skip_continue:
            "Unfixable item (2+ attempts or persistent refusal), but items after it are independent tasks and should be executed.",
          close:
            "Unfixable item (2+ attempts, denied, or no tools) and remaining items depend on it, or no items remain.",
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

const recovery_dependency_guided: Variant = {
  name: "recovery_dependency_guided",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_dependency_guided;
