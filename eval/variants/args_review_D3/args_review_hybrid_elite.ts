import type { ReviewDecisionInput } from "../../../src/core/engine/deps.ts";
import { listBlock } from "../../../src/core/reasoner/prompts.ts";
import type { DecisionInput } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * args_review_hybrid_elite:
 * Combina la concisión y rapidez de args_review_compact con la detección precisa de fallos.
 * Incorpora Target y Expected (para alinear con el objetivo del paso), y resume Previous Errors
 * solo si existen, manteniendo el criterio calibrado de approved, args_invalid e info_missing.
 */
const REVIEW_CRITERIA_ELITE = {
  approved: "Arguments logically advance the step without invalid paths, dangerous/unrequested commands, or fabricated values.",
  args_invalid: "Malformed syntax, invalid/non-existent paths, unrequested destructive operations, or fabricated data.",
  info_missing: "Essential parameters or user credentials required by tool are missing from context.",
};

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step ? `Target: ${data.step.instruction}` : null,
    data.step?.expected ? `Goal: ${data.step.expected}` : null,
    listBlock("User Input", data.userInput),
    data.stepFailures && data.stepFailures.length > 0 ? listBlock("Previous Errors", data.stepFailures) : null,
    `Candidate: ${c.route}/${c.tool}`,
    `Args: ${c.args}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions: "Validate tool arguments concisely against target step.",
        criteria: REVIEW_CRITERIA_ELITE,
      },
    },
  };
}

const args_review_hybrid_elite: Variant = {
  name: "args_review_hybrid_elite",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_hybrid_elite;

