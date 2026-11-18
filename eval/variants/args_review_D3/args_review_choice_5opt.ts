// Hipótesis: dividir `args_invalid` en tres modos de falla concretos (`syntax_or_schema_error`, `fabricated_or_mismatch`, `unsafe_or_destructive`) dentro de una pregunta `choice` de 5 opciones, junto con `Recent reads` y `Environment` compactos, permite a `d3:2b` detectar valores inventados/contradictorios y riesgos sin penalizar rutas válidas del usuario.

import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { ReadAnswer, Variant } from "../../core/variants/types.ts";

const CRITERIA_5OPT = {
  approved:
    "Arguments match Target, use valid syntax/parameters, and fit context (including user folders from Environment).",
  syntax_or_schema_error:
    "Invalid tool syntax, PowerShell/OS mismatch (e.g. &&, Linux command or path), bad parameter/enum, or placeholder (<user>, example.com).",
  fabricated_or_mismatch:
    "URL, path, PID, sessionId, or value invented or contradicting Target, User Input, or Recent reads.",
  unsafe_or_destructive:
    "Dangerous, unrequested destructive action, sensitive/system path, secret leak, or SQL/SSRF risk.",
  info_missing:
    "Empty required parameter or missing value/credential that only the user can provide.",
};

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;
  const state = [
    data.step ? `Target: ${data.step.instruction}` : null,
    listBlock("User Input", data.userInput),
    listBlock("Recent reads", data.lastReads),
    listBlock("Environment", data.env),
    listBlock("Previous Errors", data.stepFailures),
    `Call: ${c.route}/${c.tool}`,
    `Args: ${c.args}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      review: {
        type: "choice",
        instructions: "Classify the proposed tool arguments into the most accurate category.",
        criteria: CRITERIA_5OPT,
      },
    },
  };
}

function readArgsReview(answers: Record<string, ReadAnswer>): { choice: string; probabilities: Record<string, number> } {
  const probs = answers.review?.probabilities ?? {};
  const approved = probs.approved ?? 0;
  const args_invalid =
    (probs.syntax_or_schema_error ?? 0) +
    (probs.fabricated_or_mismatch ?? 0) +
    (probs.unsafe_or_destructive ?? 0);
  const info_missing = probs.info_missing ?? 0;

  const mapped: Record<string, number> = { approved, args_invalid, info_missing };
  const choice = Object.entries(mapped).sort(([, a], [, b]) => b - a)[0][0];
  return { choice, probabilities: mapped };
}

const args_review_choice_5opt: Variant = {
  name: "args_review_choice_5opt",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
  read: { args_review_read: readArgsReview },
};

export default args_review_choice_5opt;
