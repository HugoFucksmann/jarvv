import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis:
 * 1) En 'action': Para evitar que 'close' canibalice a 'rewrite_item' (que ocurre cuando close menciona 'or no items remain'
 *    y la tarea tenía un solo ítem), close debe exigir que haya habido intentos repetidos o bloqueo insalvable:
 *    "The item cannot be completed (repeated failures, blocked, or denied) AND cannot continue."
 *    Y en replan, distinguir claramente que el plan asumió un archivo o carpeta que no existe o falta: "The plan assumed a missing file or directory that must be handled first."
 * 2) En 'independent': La pregunta probada de alta precisión ("Are the items after the failed one completely separate tasks that do not need its output?").
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
        instructions: "Choose the action that fits the failure and remaining plan:",
        criteria: {
          rewrite_item:
            "First failure on this item (1 attempt) and the command can be corrected with different parameters, flags, or syntax.",
          replan:
            "The failure shows that an assumed file, directory, or prerequisite is missing and must be found or created first. Rebuild plan.",
          skip_continue:
            "Persistent error on this item (2+ attempts, or unfixable), but the items after it are independent and can proceed. Continue.",
          close:
            "Persistent error on this item (2+ attempts, denied, or no tools) and the task cannot continue, or there are no items after it. Stop.",
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

const recovery_attempt_calibrated_rules: Variant = {
  name: "recovery_attempt_calibrated_rules",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_attempt_calibrated_rules;
