import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis:
 * Analizando las confusiones de 'recovery_unrelated_calibrated', la mayor fuente de error es:
 * 1) 'replan' se confunde con 'rewrite_item' porque el modelo cree que cualquier fallo en intento 1 es rewrite_item,
 *    cuando en realidad faltan pasos previos (instalar dependencias, liberar puerto, crear entorno/carpetas).
 * 2) 'rewrite_item' a veces cae en 'close' en intento 1 cuando hay error de verificación/tool.
 * Calibramos 'replan' explicitando: "A missing preparation step or dependency is needed before this can succeed (e.g. install package, create folder, kill process/port, convert format). Rebuild plan."
 * Y calibramos 'rewrite_item': "First attempt (1 attempt) with a fixable command, tool argument, format, or typo on this exact step. Retry."
 * Y calibramos 'close': "Item cannot be completed (2+ attempts, denied, or permanently impossible) and remaining items depend on it, or no items left. Stop."
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
            "First attempt (1 attempt) with a fixable parameter, format, command, or typo on this exact step. Retry the step.",
          replan:
            "A missing preparation step or dependency is required first (install package, create directory, free port, convert file). Rebuild plan.",
          skip_continue:
            "Cannot complete this item (2+ attempts, or refusal), but remaining items are unrelated tasks that do not need it. Continue.",
          close:
            "Cannot complete this item (2+ attempts, denied, or permanently impossible) and remaining items depend on it, or no items left. Stop.",
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

const recovery_prep_replan: Variant = {
  name: "recovery_prep_replan",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_prep_replan;
