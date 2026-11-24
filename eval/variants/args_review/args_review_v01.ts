/**
 * eval/variants/args_review/args_review_v01.ts
 *
 * Args Review completa:
 * - review (choice): todas las opciones válidas del contrato (approved, args_invalid, info_missing).
 */

import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const REVIEW_CRITERIA: Record<string, string> = {
  approved: "Arguments are accurate, safe, completely specified, and directly align with the step target.",
  args_invalid: "Arguments contain fixable flaws: typo, missing parameter, invalid path format, wrong flag, or slightly off values.",
  info_missing: "The call is missing required user information, context is ambiguous, or prerequisite information must be requested first.",
};

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildArgsReview(data);
  const reviewQ = base.questions.review;
  if (reviewQ.type !== "choice") return base;

  return {
    ...base,
    questions: {
      review: {
        ...reviewQ,
        instructions: "Validate tool arguments concisely against target requirements and previous errors.",
        criteria: {
          approved: REVIEW_CRITERIA.approved,
          args_invalid: REVIEW_CRITERIA.args_invalid,
          info_missing: REVIEW_CRITERIA.info_missing,
        },
      },
    },
  };
}

const args_review_v01: Variant = {
  name: "args_review_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};
export default args_review_v01;
