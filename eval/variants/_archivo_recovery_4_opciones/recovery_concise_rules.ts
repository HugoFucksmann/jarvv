import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: Simplicidad extrema en cada criterio con una regla de una sola frase concisa:
 * rewrite_item: intentar el mismo ítem con otra sintaxis si falló una sola vez.
 * replan: replanificar porque falta un paso previo.
 * skip_continue: saltear este ítem y seguir con los siguientes que no lo necesitan.
 * close: cerrar la tarea porque el ítem no se puede hacer y los siguientes dependen de él, o no hay más ítems.
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
        instructions: "Pick what to do next after this failure:",
        criteria: {
          rewrite_item:
            "Retry this item with corrected arguments or syntax (only for a single initial failure).",
          replan:
            "Rebuild the plan because an essential prerequisite step is missing or wrong.",
          skip_continue:
            "Skip this unfixable item and continue with the remaining items that do not need it.",
          close:
            "Stop the task because this item cannot be fixed and remaining items require it, or no items remain.",
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

const recovery_concise_rules: Variant = {
  name: "recovery_concise_rules",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_concise_rules;
