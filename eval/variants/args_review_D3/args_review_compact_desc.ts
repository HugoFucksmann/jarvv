import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const REVIEW_CRITERIA_COMPACT = {
  approved: "Arguments are valid, logical, and safe for this action.",
  args_invalid: "Malformed syntax, invalid paths, dangerous commands, or fabricated values.",
  info_missing: "Required information or credentials must be requested from user.",
};

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step ? `Step: ${data.step.instruction}` : null,
    data.step?.expected ? `Expected: ${data.step.expected}` : null,
    listBlock("User Input", data.userInput),
    `Tool: ${c.route}/${c.tool}`,
    c.description ? `Description: ${c.description}` : null,
    `Arguments: ${c.args}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions: "Validate tool arguments concisely.",
        criteria: REVIEW_CRITERIA_COMPACT,
      },
    },
  };
}

const args_review_compact_desc: Variant = {
  name: "args_review_compact_desc",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_compact_desc;

