import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis:
 * Tomar la fórmula de 'recovery_dependency_guided' (que logró 75.9% de passRate y 94.1% de independent en recovery_casos),
 * pero reforzar 'replan' contra confusiones con rewrite_item explicitando que el plan omitió un paso previo de carpeta/archivo/búsqueda:
 * "The plan omitted a necessary prior step (creating a folder or locating a file) before this one. Rebuild plan."
 * Y mantener la formulación de 'independent' calibrada.
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
            "First failure on this item (1 attempt) with a fixable command, typo, or syntax. Retry the same goal.",
          replan:
            "The plan omitted a necessary prior step (creating a folder or locating a file first). Rebuild plan.",
          skip_continue:
            "Unfixable item (2+ attempts, or refusal), but items after it are independent tasks and should be executed. Continue.",
          close:
            "Unfixable item (2+ attempts, denied, or no tools) and remaining items depend on it, or no items after it. Stop.",
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

const recovery_omitted_step: Variant = {
  name: "recovery_omitted_step",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_omitted_step;
