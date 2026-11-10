import type { ReviewDecisionInput } from "../../../src/core/engine/deps.ts";
import { listBlock } from "../../../src/core/reasoner/prompts.ts";
import type { DecisionInput } from "../../../src/core/reasoner/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Ronda 2. args_review_compact_history + el schema de la herramienta (para detectar parámetros faltantes o de más). */
const CRITERIA = {
  approved: "Arguments are valid, logical, and safe for this action.",
  args_invalid: "Malformed syntax, invalid paths, dangerous commands, or fabricated values.",
  info_missing: "Required information or credentials must be requested from user.",
};

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step ? `Target: ${data.step.instruction}` : null,
    listBlock("User Input", data.userInput),
    listBlock("Previous Errors", data.stepFailures),
    `Call: ${c.route}/${c.tool}`,
    `Schema: ${c.schema}`,
    `Args: ${c.args}`,
  ].filter(Boolean).join("\n");
  return { state, questions: { review: { type: "choice", instructions: "Validate tool arguments concisely.", criteria: CRITERIA } } };
}

const args_review_compact_schema: Variant = { name: "args_review_compact_schema", prompts: { DECISION_PROMPTS: { buildArgsReview } } };
export default args_review_compact_schema;
