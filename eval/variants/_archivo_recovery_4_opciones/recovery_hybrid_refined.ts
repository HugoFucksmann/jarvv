import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: Tomar la estructura ganadora de 'recovery_targeted_rules' y perfeccionar la separación
 * de 'replan' (para no canibalizar casos de replan en recovery3/recovery_casos) y 'close' (haciendo explícito
 * que no hay ítems restantes o que los restantes dependen de él), manteniendo las frases afirmativas cortas.
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
        instructions: "Select the recovery action based on fixability, prerequisite gaps, and remaining item dependency.",
        criteria: {
          rewrite_item:
            "The item failed on its first attempt due to wrong arguments, bad format, or syntax. Retry the same goal with a corrected call.",
          replan:
            "The plan assumed something that is missing or wrong (a folder or file must be found/created first). Rebuild what remains.",
          skip_continue:
            "The item cannot be completed (repeated failures or persistent refusal), but items after it do not depend on it. Proceed with next items.",
          close:
            "The item cannot be completed (repeated failures, blocked, or denied) and remaining items depend on it, or there are no items after it.",
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

const recovery_hybrid_refined: Variant = {
  name: "recovery_hybrid_refined",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_hybrid_refined;
