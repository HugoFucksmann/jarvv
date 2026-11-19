import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: Criterios completamente concretos y simétricos basados en dos ejes observables:
 * 1) ¿El ítem es reintentable o no? (Intentos y tipo de error)
 * 2) Si no es reintentable: ¿hay ítems detrás y son independientes (skip_continue) o no hay nada más/dependen (close)?
 * Si falta algo antes en el entorno -> replan.
 * Dataset: eval/datasets/recovery (recovery_casos, recovery2, recovery3)
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
        instructions: "Choose the action that precisely matches the situation:",
        criteria: {
          rewrite_item:
            "First failure (1 attempt) and the command can be fixed with different parameters, flags, or syntax.",
          replan:
            "A prerequisite step is missing before this one (like creating a directory or finding a missing file first).",
          skip_continue:
            "Persistent failure (2+ attempts, or unrecoverable error) AND there are remaining items that do not need this result.",
          close:
            "Persistent failure (2+ attempts, denied, or no tools) AND remaining items cannot proceed without this, or Items after it: none.",
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

const recovery_concrete_axes: Variant = {
  name: "recovery_concrete_axes",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_concrete_axes;
