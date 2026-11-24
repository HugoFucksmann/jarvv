/**
 * eval/variants/recovery/recovery_v01.ts
 *
 * Recovery completa:
 * - action (choice): rewrite_item, replan, close con criterios exhaustivos.
 */

import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
import type { Variant } from "../../core/variants/types.ts";

const RECOVERY_CRITERIA: Record<string, string> = {
  rewrite_item: "First attempt (1 attempt) with a fixable command, parameter, syntax error, or typo on this specific step. Retry with corrected args.",
  replan: "A prerequisite step or external dependency is missing first (install package, create parent directory, free locked port, convert format). Rebuild the step sequence.",
  close: "The item cannot be completed (persistent error, blocked access, denied permissions, service does not exist, tests fail after multiple retries, or 2+ attempts), or no pending items remain. Stop.",
};

function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildRecovery(data);
  const recQ = base.questions[RECOVERY_KEY];
  if (!recQ || recQ.type !== "choice") return base;

  return {
    ...base,
    questions: {
      [RECOVERY_KEY]: {
        ...recQ,
        instructions: "Choose the recovery action based on the failure reason, attempts count, and pending items:",
        criteria: {
          ...recQ.criteria,
          ...RECOVERY_CRITERIA,
        },
      },
    },
  };
}

const recovery_v01: Variant = {
  name: "recovery_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};
export default recovery_v01;
