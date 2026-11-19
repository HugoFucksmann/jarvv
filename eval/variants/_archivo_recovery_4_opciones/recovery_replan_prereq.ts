import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: Aclarar en replan que solo aplica cuando hay una alternativa viable que crear o buscar ("a fixable assumption"),
 * y que cuando la búsqueda previa ya confirmó que el recurso no existe o no hay red, debe cerrarse (close).
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
        instructions: "The step for the item that just failed did not work. Pick what to do next based on attempts and dependency.",
        criteria: {
          rewrite_item:
            "On a first attempt, the goal is still valid and the failure looks fixable (a typo, missing argument, wrong format, or different approach). Try the same goal again.",
          replan:
            "The failure reveals a missing prerequisite that can be created or searched first. Rebuild what remains to solve it.",
          skip_continue:
            "After repeated failures or persistent error, the item cannot be fixed, but remaining items do NOT need its result. Skip it and proceed with them.",
          close:
            "The item cannot be fixed (unreachable network, nonexistent file, refused) AND remaining items require its result (or there are no items after it). The task must stop.",
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

const recovery_replan_prereq: Variant = {
  name: "recovery_replan_prereq",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_replan_prereq;
