import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis (Ronda 6):
 * Idéntico a recovery_prod_replan_fusion, pero preservando las palabras textuales de prod
 * en replan ("The failure shows that something the plan assumed is missing or wrong (for example a folder or file that must be created or found first). What remains must be rebuilt.")
 * sin agregar "dependency", y en rewrite_item explicitando "(1 attempt)" para evitar que se coma
 * casos de 2+ intentos.
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
          "The step for the item that just failed did not work. Pick what to do next:",
        criteria: {
          rewrite_item:
            "The goal is still valid and fixable (1 attempt so far; wrong argument, format, typo, or command approach). Try the same goal again.",
          replan:
            "The failure shows that something the plan assumed is missing or wrong (for example a folder or file that must be created or found first). What remains must be rebuilt.",
          skip_continue:
            "The failed item cannot be fixed, but remaining items are unrelated tasks that do not need its result. Leave it and continue with them.",
          close:
            "The failed item cannot be fixed (persistent error, denied, or 2+ attempts) and remaining items depend on it, or no items remain. Stop.",
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

const recovery_exact_prod_replan: Variant = {
  name: "recovery_exact_prod_replan",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_exact_prod_replan;
