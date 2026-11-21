/**
 * eval/variants/recovery/recovery_v1.ts
 *
 * Variante dedicada para la etapa `recovery` (`buildRecovery`).
 * Decide estrictamente entre las 3 acciones vigentes (`rewrite_item`, `replan`, `close`).
 */

import { RECOVERY_KEY, type RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { type DecisionInput, PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const cause = data.cause === null ? "unknown" : data.cause;
  const failedBlock = [
    "### THE STEP THAT JUST FAILED",
    `Item: ${safe(data.failed)}`,
    `Why it failed: ${cause}`,
    `Attempts so far: ${data.attempts}`,
    "Items after it: none",
  ].join("\n");

  return {
    state: `${PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view })}\n\n${failedBlock}`,
    questions: {
      [RECOVERY_KEY]: {
        type: "choice",
        instructions:
          "Pick the recovery action for the failed item based on cause, attempt count, and whether a prerequisite is missing:",
        criteria: {
          rewrite_item:
            "First attempt (attempts = 1) where the same goal only failed due to phrasing, syntax, flag, filename, or query term and can succeed on retry.",
          replan:
            "Failure exposes a missing prerequisite or discovery step first (locate unknown path, create missing folder, install dependency, resolve PID/lock).",
          close:
            "Unrecoverable or policy-stopped (attempts >= 2, user_rejected, denied, call_cap, repeat_blocked, no_tools, or missing target/app that cannot be fixed).",
        },
      },
    },
  };
}

const recovery_v1: Variant = {
  name: "recovery_v1",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_v1;
