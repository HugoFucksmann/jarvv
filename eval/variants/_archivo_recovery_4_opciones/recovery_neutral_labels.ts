import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Variante de ejemplo para `recovery` (sirve de plantilla): SOLO la pregunta `action`, sin la de dependencia, y sin el rótulo heredado de `pending`.
 *
 * La vista de `pending` rotula los fallos como «FAILED TASKS (REPLACE IN PENDING)», una instrucción que pertenece a otra consulta y que podría sesgar al decisor hacia
 * «reescribir». Esta variante la reemplaza por un rótulo neutro. Hipótesis a medir contra `prod`: ¿cambia el acierto de `rewrite_item` frente a `close` y `replan`?
 *
 * Como no trae la pregunta `independent`, las expectativas `answers.independent` del dataset no se evalúan con ella.
 */
function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const view = PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }).replace("### FAILED TASKS (REPLACE IN PENDING):", "### FAILED CALLS:");
  const behind = data.behind.length > 0 ? data.behind.map((item, i) => `${i + 1}) ${safe(item)}`).join(" ") : "none";
  const failedBlock = [
    "### THE STEP THAT JUST FAILED",
    `Item: ${safe(data.failed)}`,
    `Why it failed: ${data.cause ?? "unknown"}`,
    `Failed steps on this item so far: ${data.attempts}`,
    `Items after it: ${behind}`,
  ].join("\n");
  return {
    state: `${view}\n\n${failedBlock}`,
    questions: {
      [RECOVERY_KEY]: {
        type: "choice",
        instructions: "The step for the item that just failed did not work. Pick what to do next.",
        criteria: {
          rewrite_item:
            "The goal is still valid and the failure looks fixable (a wrong or missing argument, a wrong format, a typo, another wording or another approach). Try the same goal again; the items after it stay as they are.",
          replan:
            "The failure shows that something the plan assumed is missing or wrong (for example a folder or file that must be created or found first). What remains must be rebuilt.",
          skip_continue: "The failed item cannot be fixed, but none of the items after it needs its result. Leave it and continue with them.",
          close:
            "The failed item cannot be fixed (or the user or the security policy refused it) and the task cannot go on without it, or there is nothing left to do.",
        },
      },
    },
  };
}

const recovery_neutral_labels: Variant = {
  name: "recovery_neutral_labels",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_neutral_labels;
