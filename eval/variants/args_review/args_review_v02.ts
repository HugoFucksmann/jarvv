/**
 * eval/variants/args_review/args_review_v02.ts
 *
 * Args Review — variante v02:
 * - review (choice): approved / args_invalid / info_missing
 *
 * Hipótesis: v01 clarificó los tres criterios. El borde difícil restante es
 * la confusión entre args_invalid e info_missing cuando el argumento existe pero
 * podría ser incorrecto por falta de contexto del usuario (p. ej. una ruta que parece
 * válida pero no se confirmó). v02 agrega una regla de desempate: si el problema es
 * que el modelo tuvo que inventar un valor porque el usuario no lo dio → info_missing;
 * si el modelo tiene el valor pero está mal formado o es peligroso → args_invalid.
 */

import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const REVIEW_CRITERIA: Record<string, string> = {
  approved: "Arguments are accurate, safe, completely specified, and directly align with the step target. No invented values.",
  args_invalid:
    "The user provided (or the context supplies) the value, but it is malformed, dangerous, or wrong: bad path format, missing required flag, typo, unsafe command, or value that contradicts the step.",
  info_missing:
    "A required value was never given by the user and cannot be safely inferred from context: the agent would have to invent it. Ask the user instead.",
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
        // Nueva instrucción: añade la regla de desempate args_invalid ↔ info_missing.
        instructions:
          "Validate tool arguments against the step target and previous errors. " +
          "Tiebreaker: if the value exists in context but is wrong/malformed → args_invalid; " +
          "if the value was never provided and would need to be invented → info_missing.",
        criteria: {
          approved: REVIEW_CRITERIA.approved,
          args_invalid: REVIEW_CRITERIA.args_invalid,
          info_missing: REVIEW_CRITERIA.info_missing,
        },
      },
    },
  };
}

const args_review_v02: Variant = {
  name: "args_review_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};
export default args_review_v02;
