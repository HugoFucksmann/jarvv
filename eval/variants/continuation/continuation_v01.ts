/**
 * eval/variants/continuation/continuation_v01.ts
 *
 * Continuation completa:
 * - follow (noul): true / false
 */

import type { ContinuationInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const FOLLOW_CRITERIA = {
  true: "The new request refers to the previous task (using pronouns like 'it', 'that', 'also', 'now') or requires the previous result/context to be understood.",
  false: "The new request is independent, self-contained, or switches to an entirely different topic.",
};

function buildContinuation(data: ContinuationInput): DecisionInput {
  const base = DECISION_PROMPTS.buildContinuation(data);
  const followQ = base.questions.follow;
  if (!followQ || followQ.type !== "noul") return base;

  return {
    ...base,
    questions: {
      follow: {
        ...followQ,
        instructions: 'Does the new request depend on the previous task: does it refer to it ("it", "that", "the first one", "also", "now") or need its result to be understood?',
        criteria: FOLLOW_CRITERIA,
      },
    },
  };
}

const continuation_v01: Variant = {
  name: "continuation_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};
export default continuation_v01;
