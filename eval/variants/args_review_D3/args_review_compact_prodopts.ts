import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 1. Estado de args_review_compact_history con las opciones (criterios) de producción: aísla el efecto del estado del de los criterios. */
function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step ? `Target: ${data.step.instruction}` : null,
    listBlock("User Input", data.userInput),
    listBlock("Previous Errors", data.stepFailures),
    `Call: ${c.route}/${c.tool}`,
    `Args: ${c.args}`,
  ].filter(Boolean).join("\n");
  return { state, questions: { review: { type: "choice", instructions: "Validate tool arguments concisely.", criteria: {
    approved: "The call correctly advances the current step. Its arguments are valid for that step. Technical syntax and standard language or operating system features can be generated from general knowledge.",
    args_invalid: "The call fits the current step, but at least one specific argument value is demonstrably wrong, fabricated, incorrectly copied or contradicts the available context. Do not reject standard technical syntax or features.",
    info_missing: "The call requires a specific value that only the user can provide. That value is missing from the task, user input and latest reads.",
  } } } };
}

const args_review_compact_prodopts: Variant = { name: "args_review_compact_prodopts", prompts: { DECISION_PROMPTS: { buildArgsReview } } };
export default args_review_compact_prodopts;
