// Hipótesis: mantener la pregunta `review` de 3 opciones (`choice`) junto con dos sondas binarias (`has_fabricated_or_contradicted` y `missing_from_user`) en la misma consulta mejora el contraste sobre `Recent reads` y `Environment`, y un veto con umbral alto (0.70) frena aprobaciones de valores inventados sin disparar falsos rechazos.

import type { ReviewDecisionInput } from "../../../../src/core/contracts.ts";
import { listBlock } from "../../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import type { ReadAnswer, Variant } from "../../../core/variants/types.ts";

const REVIEW_CRITERIA = {
  approved: "Arguments are valid, logical, and safe for this action (user folders from Environment are valid).",
  args_invalid: "Malformed syntax, invalid/invented paths or IDs, dangerous commands, or values contradicting Recent reads.",
  info_missing: "Required information or credentials must be requested from user.",
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
        instructions: "Validate tool arguments concisely against context.",
        criteria: REVIEW_CRITERIA,
      },
      has_fabricated_or_contradicted: {
        type: "noul",
        instructions:
          "Does Args contain an invented URL, fake path, placeholder, or ID/PID/sessionId that contradicts Recent reads or Target? Standard user folders from Environment are valid.",
        criteria: {
          true: "Contains a fabricated URL/path/placeholder or contradicts Recent reads.",
          false: "No fabricated values or contradictions with Recent reads.",
        },
      },
      missing_from_user: {
        type: "noul",
        instructions:
          "Is a required destination, file, message, or secret missing because the user has not provided it yet?",
        criteria: {
          true: "A required user-provided value is empty or placeholder.",
          false: "No required user input is missing.",
        },
      },
    },
  };
}

function readArgsReview(answers: Record<string, ReadAnswer>): { choice: string; probabilities: Record<string, number> } {
  const base = answers.review?.probabilities ?? {};
  let approved = base.approved ?? 0;
  let args_invalid = base.args_invalid ?? 0;
  let info_missing = base.info_missing ?? 0;

  const pFab = answers.has_fabricated_or_contradicted?.noul ?? 0;
  const pMiss = answers.missing_from_user?.noul ?? 0;

  if (pFab >= 0.7) {
    approved = Math.min(approved, 1 - pFab);
    args_invalid = Math.max(args_invalid, pFab);
  } else if (pMiss >= 0.7 && args_invalid < 0.6) {
    approved = Math.min(approved, 1 - pMiss);
    info_missing = Math.max(info_missing, pMiss);
  }

  const probs: Record<string, number> = { approved, args_invalid, info_missing };
  const choice = Object.entries(probs).sort(([, a], [, b]) => b - a)[0][0];
  return { choice, probabilities: probs };
}

const args_review_choice_plus_probe: Variant = {
  name: "args_review_choice_plus_probe",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
  read: { args_review_read: readArgsReview },
};

export default args_review_choice_plus_probe;
