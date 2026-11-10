import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const REVIEW_CRITERIA_PRECISE = {
  approved: "Arguments accurately fulfill the step intention without invented parameters, syntax errors, or destructive side effects.",
  args_invalid: "Malformed syntax, invalid/non-existent paths, unsafe operations, or invented data.",
  info_missing: "Lacks essential parameters, user consent, or credentials not found in context.",
};

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step ? `Step: ${data.step.instruction}` : null,
    data.step?.expected ? `Goal: ${data.step.expected}` : null,
    listBlock("User Input", data.userInput),
    listBlock("Previous Failures", data.stepFailures),
    `Candidate: ${c.route}/${c.tool}`,
    `Arguments: ${c.args}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions: "Evaluate candidate call arguments against step goal.",
        criteria: REVIEW_CRITERIA_PRECISE,
      },
    },
  };
}

const args_review_precise: Variant = {
  name: "args_review_precise",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_precise;

