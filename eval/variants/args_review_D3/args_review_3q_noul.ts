// Hipótesis: descomponer D3 en tres preguntas `noul` ortogonales (`needs_user_info`, `valid_and_safe`, `faithful_to_context`) con `Recent reads` y `Environment` evita que la sensibilidad a "grounded" rechace rutas reales de `Environment` (como `C:/Users/hugof/...`) mientras detecta URLs/PIDs/archivos inventados o contradictorios.

import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

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
      needs_user_info: {
        type: "noul",
        instructions:
          "Is a required value (destination, file, message, or secret) genuinely missing from Target, User Input, and Recent reads so the user must be asked?",
        criteria: {
          true: "Required parameter is empty or placeholder waiting for user input.",
          false: "All needed values are present in Target or context.",
        },
      },
      valid_and_safe: {
        type: "noul",
        instructions:
          "Are syntax, tool parameters, and safety valid for Windows PowerShell/files (no &&, no Linux commands/paths, no placeholders like example.com, no unrequested destructive or sensitive actions)?",
        criteria: {
          true: "Valid syntax, valid parameters, and safe for this step.",
          false: "Syntax error, OS mismatch, placeholder, invalid parameter, or unsafe action.",
        },
      },
      faithful_to_context: {
        type: "noul",
        instructions:
          "Do specific IDs, sessionIds, URLs, paths, and values in Args match Target, User Input, Environment, and Recent reads?",
        criteria: {
          true: "Values match context or standard user folders from Environment.",
          false: "Invents a fake path/URL/ID or contradicts Recent reads (wrong PID, file after 0 matches, extra unrequested file).",
        },
      },
    },
  };
}

function readArgsReview(answers: Record<string, number>): { choice: string; probabilities: Record<string, number> } {
  const pMissing = answers.needs_user_info ?? 0;
  const pValid = answers.valid_and_safe ?? 0;
  const pFaithful = answers.faithful_to_context ?? 0;

  const approved = Math.min(1 - pMissing, pValid, pFaithful);
  const args_invalid = Math.max(1 - pValid, 1 - pFaithful);
  const info_missing = pMissing;

  const choice =
    approved >= 0.6 ? "approved" : info_missing > args_invalid ? "info_missing" : "args_invalid";

  return {
    choice,
    probabilities: { approved, args_invalid, info_missing },
  };
}

const args_review_3q_noul: Variant = {
  name: "args_review_3q_noul",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
  read: { args_review: readArgsReview },
};

export default args_review_3q_noul;
