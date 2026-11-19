import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: La instrucción debe forzar explícitamente la lectura de 'Failed steps on this item so far':
 * Si es 2 o más, no es corregible con reescritura ('rewrite_item' prohibido para 2+ intentos).
 * Para 2+ intentos, la elección es exclusivamente entre skip_continue (si los ítems posteriores son independientes)
 * o close (si dependen o no hay ítems).
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
          "Read 'Failed steps on this item so far'. If attempts >= 2 or unrecoverable, do NOT choose rewrite_item. Choose what to do next:",
        criteria: {
          rewrite_item:
            "Only when Failed steps so far is 1: retry this item with corrected arguments or different syntax.",
          replan:
            "When a prerequisite step must be created or searched first (e.g. missing folder or file): rebuild plan.",
          skip_continue:
            "When Failed steps so far >= 2 (or unfixable): drop this item and execute the remaining items after it.",
          close:
            "When Failed steps so far >= 2 (or unfixable): and items after it depend on it, or Items after it is none.",
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

const recovery_attempt_constraint: Variant = {
  name: "recovery_attempt_constraint",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_attempt_constraint;
