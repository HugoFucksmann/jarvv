import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis (Ronda 5):
 * Al comparar 'recovery_unrelated_calibrated' (close: 80.6%, replan: 53.8%)
 * y 'recovery_prep_replan' (rewrite_item: 94.3%, skip_continue: 73.3%),
 * identificamos que 'close' cayó en prep_replan porque su criterio perdió la mención a
 * "or no items remain" como condición suficiente de cierre inmediato.
 *
 * En esta variante 'recovery_calibrated_synthesis':
 * - rewrite_item: mantenemos la formulación de alta precisión de prep_replan:
 *   "First attempt (1 attempt) with a fixable command, parameter, format, or typo on this step. Retry."
 * - replan: "A prerequisite step or dependency is missing first (install package, create folder, free port, convert format). Rebuild plan."
 * - skip_continue: "Item cannot be completed (2+ attempts, or refusal), but remaining items are unrelated tasks that do not need it. Continue."
 * - close: recuperamos la formulación fuerte de calibrated:
 *   "The item cannot be completed (persistent error, blocked, denied, or 2+ attempts) and remaining items depend on it, or no items remain. Stop."
 * - independent: la fórmula calibrada que da ~88% de acierto.
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
            "A prerequisite step or dependency is missing first (install package, create folder, free port, convert format). Rebuild plan.",
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

const recovery_calibrated_synthesis: Variant = {
  name: "recovery_calibrated_synthesis",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_calibrated_synthesis;
