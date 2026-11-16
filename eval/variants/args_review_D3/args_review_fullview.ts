import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/** Reproduce `reviewFullView: true` sin editar `jarvis-config.json`: incluye lecturas recientes y entorno en D3. */
function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  return DECISION_PROMPTS.buildArgsReview(data, { fullView: true });
}

const args_review_fullview: Variant = {
  name: "args_review_fullview",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_fullview;
