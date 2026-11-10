import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const REVIEW_CRITERIA_STRICT = {
  approved: "Every argument is valid, correctly mapped, and matches the step intention without inventing parameters.",
  args_invalid: "An argument contains invalid syntax, placeholders, wrong paths, or invented data.",
  info_missing: "The tool requires user confirmation, credentials, or choices not present in the context.",
};

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step === null ? null : `Target Step: ${data.step.instruction}`,
    data.step?.expected ? `Expected: ${data.step.expected}` : null,
    listBlock("User input", data.userInput),
    listBlock("Failed attempts", data.stepFailures),
    `Tool: ${c.route}/${c.tool}`,
    `Args: ${c.args}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions: "Strictly validate the candidate tool call arguments.",
        criteria: REVIEW_CRITERIA_STRICT,
      },
    },
  };
}

const args_review_strict: Variant = {
  name: "args_review_strict",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_strict;

