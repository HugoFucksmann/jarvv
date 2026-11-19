import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: Poner explícitamente en el estado si los ítems restantes dependen o son independientes
 * del fallido ("Items after it: none (task cannot continue after this)" o enumerándolos con indicación clara)
 * y en el criterio de close vs skip_continue diferenciar estrictamente por la presencia de ítems restantes.
 * Dataset: eval/datasets/recovery
 */
function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const behind =
    data.behind.length > 0
      ? data.behind.map((item, i) => `${i + 1}) ${safe(item)}`).join(" ")
      : "none (no remaining items; nothing left to do after this)";
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
        instructions: "The step for the item that just failed did not work. Pick what to do next based on attempts and dependency.",
        criteria: {
          rewrite_item:
            "On a first attempt, the goal is still valid and the failure looks fixable (a typo, missing argument, wrong format, or different approach). Try the same goal again.",
          replan:
            "The failure shows that something the plan assumed is missing or wrong (e.g. a prerequisite folder or file). What remains must be rebuilt.",
          skip_continue:
            "After repeated failures or persistent error, the item cannot be fixed, but there are remaining items after it that do not need its result. Skip it and continue with them.",
          close:
            "The item cannot be fixed (or was refused/blocked), and either remaining items depend on it or there are no items after it. Stop the task.",
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

const recovery_explicit_dependency: Variant = {
  name: "recovery_explicit_dependency",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_explicit_dependency;
