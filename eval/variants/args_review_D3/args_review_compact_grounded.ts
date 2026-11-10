import type { ReviewDecisionInput } from "../../../src/core/engine/deps.ts";
import { listBlock } from "../../../src/core/reasoner/prompts.ts";
import type { DecisionInput } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Ronda 2. Estado de args_review_compact_history; criterios centrados en que cada valor tenga origen (Target, User Input, errores previos)
 * y no en la sintaxis (de eso se ocupa el pre-chequeo determinista de producción).
 */
const CRITERIA = {
  approved: "Every value in Args comes from Target or User Input, or is a standard value for this action.",
  args_invalid: "A value in Args is invented, copied wrongly, malformed, or contradicts Target or User Input.",
  info_missing: "The call needs a value that only the user can give, and it is not in Target or User Input.",
};

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step ? `Target: ${data.step.instruction}` : null,
    listBlock("User Input", data.userInput),
    listBlock("Previous Errors", data.stepFailures),
    `Call: ${c.route}/${c.tool}`,
    `Args: ${c.args}`,
  ].filter(Boolean).join("\n");
  return { state, questions: { review: { type: "choice", instructions: "Check where each argument value comes from.", criteria: CRITERIA } } };
}

const args_review_compact_grounded: Variant = { name: "args_review_compact_grounded", prompts: { DECISION_PROMPTS: { buildArgsReview } } };
export default args_review_compact_grounded;
