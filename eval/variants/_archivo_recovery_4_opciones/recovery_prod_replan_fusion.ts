import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis (Ronda 6):
 * Descubrimiento clave tras analizar las activaciones del 2B:
 * - 'prod' tiene un acierto altísimo en replan (80.8%) gracias a su redacción:
 *   "The failure shows that something the plan assumed is missing or wrong (for example a folder or file that must be created or found first). What remains must be rebuilt."
 * - 'recovery_unrelated_calibrated' y 'recovery_prep_replan' lograron levantar 'skip_continue' del 16% al 73%
 *   y 'close' del 22% al 74%, y 'rewrite_item' al 88-94%, pero degradaron 'replan' al 42% por cambiar la formulación de replan.
 * - Además, la formulación de 'independent' calibrada ("Are the items after the failed one completely separate tasks...")
 *   alcanza 88% de acierto.
 *
 * En esta variante fusionamos:
 * - El 'replan' exacto de prod (que el modelo 2B reconoce a la perfección).
 * - El 'rewrite_item' de prod pulido para retener la validación de meta fixable.
 * - El 'skip_continue' calibrado (unrelated tasks that do not need it).
 * - El 'close' calibrado (persistent error, blocked, denied, 2+ attempts, or no items remain).
 * - El 'independent' calibrado.
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
            "The goal is still valid and the failure looks fixable (a wrong or missing argument, format, typo, or another command). Try the same goal again.",
          replan:
            "The failure shows that something the plan assumed is missing or wrong (for example a folder, dependency, or file that must be created or found first). What remains must be rebuilt.",
          skip_continue:
            "The failed item cannot be completed, but remaining items are unrelated tasks that do not need its result. Leave it and continue with them.",
          close:
            "The failed item cannot be completed (persistent error, blocked, denied, or 2+ attempts) and remaining items depend on it, or no items remain. Stop.",
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

const recovery_prod_replan_fusion: Variant = {
  name: "recovery_prod_replan_fusion",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_prod_replan_fusion;
