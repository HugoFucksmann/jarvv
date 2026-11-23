/**
 * eval/variants/args_review/args_review_v2.ts
 *
 * Hipótesis: enfatizar en `instructions` las reglas específicas de PowerShell/Windows, placeholders y sobrescritura mejora la detección de llamadas riesgosas o malformadas.
 */

import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const REVIEW_INSTRUCTIONS =
  "Audit Call and Args against Target and User Input: reject PowerShell 5.1 syntax errors (&&, Linux commands, calculated hashtables @{...}), invented paths/URLs, or unsafe mutations as args_invalid; choose info_missing when a required user value or confirmation is empty or absent.";

function buildArgsReview(
  data: Parameters<typeof DECISION_PROMPTS.buildArgsReview>[0],
  options?: Parameters<typeof DECISION_PROMPTS.buildArgsReview>[1],
): DecisionInput {
  const base = DECISION_PROMPTS.buildArgsReview(data, options);
  const review = base.questions.review;
  if (review?.type !== "choice") return base;
  return {
    ...base,
    questions: {
      ...base.questions,
      review: { ...review, instructions: REVIEW_INSTRUCTIONS },
    },
  };
}

const args_review_v2: Variant = {
  name: "args_review_v2",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_v2;
