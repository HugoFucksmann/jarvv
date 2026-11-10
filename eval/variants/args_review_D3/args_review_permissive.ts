import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const REVIEW_CRITERIA_PERMISSIVE = {
  approved: "The tool fits the step and the arguments are syntactically and logically sound. Standard commands or system properties do not need to be in context.",
  args_invalid: "The arguments are demonstrably wrong: invalid syntax, fabricated paths, or contradiction with context.",
  info_missing: "Information is missing that only the user can provide.",
};

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const reads = data.lastReads.length === 0 ? null : `Latest reads:\n<obs>\n${data.lastReads.join("\n\n")}\n</obs>`;
  const c = data.candidate;

  const state = [
    data.step === null ? null : `Step: ${data.step.instruction}`,
    listBlock("User input", data.userInput),
    listBlock("Environment", data.env),
    reads,
    `Candidate Call: ${c.route}/${c.tool}\nArguments: ${c.args}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions: "Verify if the arguments are valid and advance the step. Accept standard commands and system properties.",
        criteria: REVIEW_CRITERIA_PERMISSIVE,
      },
    },
  };
}

const args_review_permissive: Variant = {
  name: "args_review_permissive",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_permissive;

