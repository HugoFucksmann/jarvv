/**
 * eval/variants/args_review/args_review_v01.ts
 *
 * Variante `mode: "prompt"` de `args_review`.
 * Hipótesis: separar explícitamente en `criteria` cuándo el argumento viola sintaxis/reglas/seguridad/Target (`args_invalid`)
 * vs cuándo falta información que solo el usuario puede aportar (`info_missing`, p. ej. cadenas vacías o marcadores de falta de dato)
 * reduce la confusión entre ambos rechazos sin alargar el estado compacto de `prod`.
 */

import type { ArgsReview, ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { ARGS_REVIEWS } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS, listBlock } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const CRITERIA: Record<ArgsReview, string> = {
  approved: "Arguments match Target and User Input, use valid syntax and real values, and are safe.",
  args_invalid:
    "Syntax error (e.g. && or POSIX commands on Windows), out-of-range value, wrong parameter format, dangerous command, or path/value contradicting Target.",
  info_missing:
    "Target lacks a required detail only the user can provide (unspecified path, content, URL, credential, or target choice) and the argument is empty or missing that user input.",
};

function buildArgsReview(data: ReviewDecisionInput, options: { readonly fullView?: boolean } = {}): DecisionInput {
  const base = DECISION_PROMPTS.buildArgsReview(data, options);
  const q = base.questions.review;
  const c = data.candidate;
  const state = [
    data.step === null ? null : `Target: ${data.step.instruction}`,
    listBlock("User Input", data.userInput),
    options.fullView === true ? listBlock("Recent reads", data.lastReads) : null,
    options.fullView === true ? listBlock("Environment", data.env) : null,
    listBlock("Previous Errors", data.stepFailures),
    `Call: ${c.route}/${c.tool}`,
    `Args: ${c.args}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions: q.instructions,
        criteria: Object.fromEntries(ARGS_REVIEWS.map((r) => [r, CRITERIA[r]])),
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
