import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis (Ronda 5):
 * Al examinar por qué el modelo 2B a veces elige rewrite_item cuando attempts >= 2,
 * observamos que el encabezado dice "Attempts so far: 2" pero la regla de rewrite_item
 * dice "First attempt (1 attempt)...". El modelo a veces ignora el número si ve un error de tool.
 * Si hacemos que la instrucción introduzca la distinción de tentativas:
 * "Check attempts count: if attempt 1 and step is fixable choose rewrite or replan; if 2+ attempts or denied choose skip_continue or close:"
 * Y en replan especificamos: "Missing prior step or environment requirement (install module, start daemon, create folder). Rebuild plan."
 * Y en close especificamos: "Failed 2+ attempts (exhausted retries), denied, or no remaining items. Stop."
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
          "Check attempts count and failure cause to pick the recovery action:",
        criteria: {
          rewrite_item:
            "Attempt 1 with a fixable command, parameter, format, or typo on this step. Retry the same step.",
          replan:
            "Attempt 1 where a missing prerequisite step must run first (install package, create folder, free port). Rebuild plan.",
          skip_continue:
            "Item cannot be completed (2+ attempts, or refusal), but remaining items are independent and should continue. Continue.",
          close:
            "Item cannot be completed (2+ attempts, denied, or no tools) and remaining items depend on it, or no items remain. Stop.",
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

const recovery_attempt_routed: Variant = {
  name: "recovery_attempt_routed",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_attempt_routed;
