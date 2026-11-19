import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis (Ronda 7):
 * En la Ronda 6 logramos un pico histórico de 66.4% de passRate global (+21.3% vs prod),
 * con 74.5% en recovery2 (+31.9%).
 *
 * El análisis de divergencia demostró que la unión de aciertos entre
 * 'recovery_calibrated_synthesis' y 'recovery_prod_replan_fusion' alcanza 97/122 (79.5%).
 * La diferencia clave entre ambas es la frontera entre 'rewrite_item' y 'replan':
 * - En 'synthesis', rewrite_item atrae demasiado (91.4% recall, pero canibaliza replan dejándolo en 38.5%).
 * - En 'fusion', replan atrae demasiado (76.9% recall, pero canibaliza rewrite_item dejándolo en 62.9%).
 *
 * En esta variante 'recovery_boundary_balance':
 * - rewrite_item: "First attempt (1 attempt) with a fixable command parameter, flag, typo, or syntax on this exact item. Retry the item."
 * - replan: "The failure shows a prerequisite step was assumed but missing (such as a folder or file to create or find first). Rebuild the plan."
 * - skip_continue: "The item cannot be completed (persistent error or refusal), but remaining items are unrelated tasks and do not need it. Continue."
 * - close: "The item cannot be completed (persistent error, blocked, denied, or 2+ attempts) and remaining items depend on it, or no items remain. Stop."
 * - independent: la fórmula calibrada ("Are the items after the failed one completely separate tasks that do not need its output?").
 *
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
            "First attempt (1 attempt) with a fixable command parameter, flag, typo, or syntax on this exact item. Retry the item.",
          replan:
            "The failure shows a prerequisite step was assumed but missing (such as a folder or file to create or find first). Rebuild the plan.",
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

const recovery_boundary_balance: Variant = {
  name: "recovery_boundary_balance",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_boundary_balance;
