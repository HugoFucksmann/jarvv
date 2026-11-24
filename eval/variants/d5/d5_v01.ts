/**
 * eval/variants/d5/d5_v01.ts
 *
 * D5 (Completion Check) completa:
 * - completion (noul): true / false
 */

import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import { COMPLETION_KEY } from "../../../src/core/contracts.ts";
import type { Variant } from "../../core/variants/types.ts";

const COMPLETION_CRITERIA = {
  true: "Every single part, constraint, and item of the original REQUEST is fully completed according to DONE.",
  false: "Any part of the REQUEST is missing, unfinished, failed, or still requires action.",
};

function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildCompletionCheck(data);
  const compQ = base.questions[COMPLETION_KEY];
  if (!compQ || compQ.type !== "noul") return base;

  return {
    ...base,
    questions: {
      [COMPLETION_KEY]: {
        ...compQ,
        instructions: "Using only what DONE shows, is every part of REQUEST already done? False if any part is missing or was never done.",
        criteria: COMPLETION_CRITERIA,
      },
    },
  };
}

const d5_v01: Variant = {
  name: "d5_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};
export default d5_v01;
