/**
 * eval/variants/continuation/continuation_v1.ts
 *
 * Variante dedicada para la etapa `continuation` (`buildContinuation`).
 * Distingue referencias anafóricas/elipsis/refinamientos de pedidos independientes en el mismo dominio.
 */

import type { ContinuationInput } from "../../../src/core/contracts.ts";
import { type DecisionInput, safe } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildContinuation(data: ContinuationInput): DecisionInput {
  return {
    state: [
      `Previous request: ${safe(data.previous.request)}`,
      `Previous answer: ${safe(data.previous.answer)}`,
      `New request: ${safe(data.request)}`,
    ].join("\n"),
    questions: {
      follow: {
        type: "noul",
        instructions:
          'Does New request depend on Previous request/answer (pronouns like "it/that/them/the first one", ellipsis like "and now in PDF?", or acting on files/items found earlier)?',
        criteria: {
          true: "Follow-up, refinement, filter change, pronoun/implicit reference, or next action using items/results from the prior turn.",
          false: "Self-contained request with all targets explicit, even if it happens in a similar topic or folder.",
        },
      },
    },
  };
}

const continuation_v1: Variant = {
  name: "continuation_v1",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};

export default continuation_v1;
