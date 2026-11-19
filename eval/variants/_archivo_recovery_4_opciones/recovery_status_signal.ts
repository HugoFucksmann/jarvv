import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
const RECOVERY_INDEPENDENT_KEY = "independent"; // la constante salió de src/ al quitar skip_continue
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: Introducir una señal de estado binaria observable [CAN_RETRY: NO] cuando attempts >= 2
 * o la causa es no recuperable (denied, user_rejected, no_tools), y [CAN_RETRY: YES] cuando attempts == 1
 * con causa recuperable. El 2B no deduce bien a partir de texto largo pero reacciona fuertemente a rótulos directos.
 * Dataset: eval/datasets/recovery (recovery_casos y recovery2)
 */
function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const behind =
    data.behind.length > 0
      ? data.behind.map((item, i) => `${i + 1}) ${safe(item)}`).join(" ")
      : "none";
  const cause = data.cause === null ? "unknown" : data.cause;

  const terminalCauses = ["denied", "user_rejected", "no_tools", "call_cap"];
  const isTerminal = data.attempts >= 2 || terminalCauses.includes(data.cause ?? "");
  const retrySignal = isTerminal
    ? "NO (attempts exceeded or unrecoverable error: do NOT rewrite; pick skip_continue, close, or replan)"
    : "YES (first attempt: prefer rewrite_item if goal is still valid)";

  const failedBlock = [
    "### THE STEP THAT JUST FAILED",
    `Item: ${safe(data.failed)}`,
    `Why it failed: ${cause}`,
    `Failed steps on this item so far: ${data.attempts}`,
    `Can retry this item: ${retrySignal}`,
    `Items after it: ${behind}`,
  ].join("\n");

  return {
    state: `${PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view })}\n\n${failedBlock}`,
    questions: {
      [RECOVERY_KEY]: {
        type: "choice",
        instructions: "The step for the item that just failed did not work. Follow 'Can retry this item' and pick what to do next.",
        criteria: {
          rewrite_item:
            "Only when 'Can retry this item: YES'. Try the same goal again with corrected arguments, format, or approach.",
          replan:
            "The failure shows a prerequisite step is missing (e.g. folder/file must be created or searched first). Rebuild remaining plan.",
          skip_continue:
            "When 'Can retry this item: NO' and remaining items do NOT need this item's result. Abandon this item and continue with next items.",
          close:
            "When 'Can retry this item: NO' and remaining items require this result (or there are no items after it). Stop task.",
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

const recovery_status_signal: Variant = {
  name: "recovery_status_signal",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_status_signal;
