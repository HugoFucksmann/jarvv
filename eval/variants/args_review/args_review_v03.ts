/**
 * eval/variants/args_review/args_review_v03.ts
 *
 * Args Review — variante v03.
 *
 * Resultado del eval:
 * - v02 ganó (+11.2%, p=0.031): el tiebreaker args_invalid ↔ info_missing funcionó.
 * - v02 tuvo 4 regresiones sobre prod en `approved`: ar-hard-27, ar-hard-32,
 *   ar-hard2-38, ar-h2h-40. Hipótesis: la instrucción de v02 ("no invented values")
 *   lleva al modelo a rechazar argumentos razonables que prod aprueba.
 *
 * Hipótesis v03: partir de v02 y:
 * 1. Suavizar `approved` para que el modelo no sobre-rechace cuando el argumento es
 *    razonable e inferible del contexto, aunque no fue dado literalmente por el usuario.
 * 2. Mantener el tiebreaker (que claramente funciona).
 */

import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const REVIEW_CRITERIA: Record<string, string> = {
  // v03: "safely inferable" — no requiere que el valor sea dado literalmente,
  // solo que no sea inventado sin base. Reduce falsos rechazos de v02.
  approved:
    "Arguments are safe, well-formed, and directly align with the step target. Values may be literal from user input or safely inferred from context (ENV, previous results, step description). No fabricated or invented values.",
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
        // Tiebreaker de v02 mantenido; `approved` suavizado para reducir regresiones.
        instructions:
          "Validate tool arguments against the step target and previous errors. " +
          "Tiebreaker: if the value exists in context but is wrong/malformed → args_invalid; " +
          "if the value was never provided and cannot be inferred → info_missing; " +
          "if the value is present and reasonable, even if inferred → approved.",
        criteria: {
          approved: REVIEW_CRITERIA.approved,
          args_invalid: REVIEW_CRITERIA.args_invalid,
          info_missing: REVIEW_CRITERIA.info_missing,
        },
      },
    },
  };
}

const args_review_v03: Variant = {
  name: "args_review_v03",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};
export default args_review_v03;
