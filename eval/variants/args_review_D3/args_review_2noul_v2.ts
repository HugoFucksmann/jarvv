/**
 * D3 — Variante 2: 2 preguntas noul con formulación más directa y criterios más detallados.
 *
 * Mismo esquema que v1 (valid + has_info) pero con distinto wording:
 *   - `valid`: foco en "¿los valores existen y son correctos?" (paths reales, no inventados)
 *   - `has_info`: foco en "¿el usuario ya dio todo lo que hace falta?" (pide vs. disponible)
 *
 * El reader usa el mismo criterio de prioridad: valid > has_info.
 */

import type { ReviewDecisionInput } from "../../../src/core/contracts.ts";
import { listBlock } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { ReadAnswer, Variant } from "../../core/variants/types.ts";

function buildArgsReview(data: ReviewDecisionInput): DecisionInput {
  const c = data.candidate;

  const state = [
    data.step === null ? null : `Target: ${data.step.instruction}`,
    listBlock("User Input", data.userInput),
    listBlock("Previous Errors", data.stepFailures),
    `Call: ${c.route}/${c.tool}`,
    `Args: ${c.args}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      valid: {
        type: "noul",
        instructions:
          "Look at every argument value: are all paths, filenames, URLs, and IDs explicitly mentioned in Target or User Input (not made up)? Is the syntax complete and free of destructive operations?",
        criteria: {
          true: "All values trace back to the task or user input; syntax is complete and safe.",
          false: "At least one value is fabricated, path does not follow from the task, syntax is broken, or the command is dangerous.",
        },
      },
      has_info: {
        type: "noul",
        instructions:
          "Can this call be executed right now with what is known? Or does it need a password, a file path, an ID, or any other detail that only the user can provide?",
        criteria: {
          true: "Everything needed is already known; no input from the user is required to run this call.",
          false: "A credential, specific value, or required detail is missing and the user must be asked before proceeding.",
        },
      },
    },
  };
}

const args_review_2noul_v2: Variant = {
  name: "args_review_2noul_v2",
  prompts: { DECISION_PROMPTS: { buildArgsReview } },
  read: {
    args_review_read: (answers: Record<string, ReadAnswer>) => {
      const pValid = answers.valid?.noul ?? 0.5;
      const pHasInfo = answers.has_info?.noul ?? 0.5;

      if (pValid < 0.6) {
        return {
          choice: "args_invalid",
          probabilities: { approved: pValid * pHasInfo, args_invalid: 1 - pValid, info_missing: 1 - pHasInfo },
        };
      }
      if (pHasInfo < 0.6) {
        return {
          choice: "info_missing",
          probabilities: { approved: pValid * pHasInfo, args_invalid: 1 - pValid, info_missing: 1 - pHasInfo },
        };
      }
      return {
        choice: "approved",
        probabilities: { approved: pValid * pHasInfo, args_invalid: 1 - pValid, info_missing: 1 - pHasInfo },
      };
    },
  },
};

export default args_review_2noul_v2;
