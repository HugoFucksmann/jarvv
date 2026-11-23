/**
 * eval/variants/args_review/args_review_v1.ts
 *
 * Hipótesis: separar con precisión los criterios de `args_review` (errores de sintaxis/seguridad/valores inventados vs datos faltantes que solo el usuario puede aportar) reduce falsos rechazos por `args_invalid` cuando falta información del usuario.
 */

import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const REVIEW_INSTRUCTIONS =
  "Classify this tool call before execution by checking Target, User Input, Previous Errors, and Args.";

const REVIEW_CRITERIA: Record<string, string> = {
  approved:
    "Arguments match Target/User Input, obey syntax and path rules, are safe, and leave no required value empty.",
  args_invalid:
    "Syntax error (e.g. && or POSIX tools in PowerShell), unsafe/forbidden path or command, invented placeholder (example.com, <user>), or wrong parameter format.",
  info_missing:
    "A required target value, path, URL, credential, or overwrite decision is missing/empty because the user has not provided it yet.",
};

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
      review: { ...review, instructions: REVIEW_INSTRUCTIONS, criteria: REVIEW_CRITERIA },
    },
  };
}

const args_review_v1: Variant = {
  name: "args_review_v1",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
};

export default args_review_v1;
