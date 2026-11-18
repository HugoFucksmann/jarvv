/**
 * D3 — Variante 1: 2 preguntas noul independientes.
 *
 * En lugar de una sola choice de 3 opciones, se separan los dos ejes del diagnóstico:
 *   - `valid`: ¿Los argumentos son sintácticamente correctos y no fabrican valores?
 *   - `has_info`: ¿Toda la información necesaria está disponible sin pedir nada al usuario?
 *
 * `read.args_review_read` recombina: si `valid` falla → args_invalid; si `has_info` falla → info_missing;
 * si ambas pasan → approved.
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
          "Are the arguments syntactically correct, do they use real paths or values that come from the step or prior reads, and avoid dangerous commands or fabricated identifiers?",
        criteria: {
          true: "Arguments are well-formed, grounded in the task context, and safe to run.",
          false: "Arguments contain malformed syntax, invented paths or IDs, empty required fields, or destructive commands.",
        },
      },
      has_info: {
        type: "noul",
        instructions:
          "Is all the information needed for this call (credentials, specific paths, required values) already available without asking the user?",
        criteria: {
          true: "Every required value is present in the step, reads, or environment.",
          false: "A required credential, path, or value is missing and must be requested from the user.",
        },
      },
    },
  };
}

const args_review_2noul_v1: Variant = {
  name: "args_review_2noul_v1",
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

export default args_review_2noul_v1;
