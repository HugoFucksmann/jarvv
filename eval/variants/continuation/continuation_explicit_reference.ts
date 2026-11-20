import type { ContinuationInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * continuation_explicit_reference
 * Hipótesis: En continuation (continuation_dev2: 81.5%), d3:2b confunde pedidos breves
 * independientes con seguimientos dependientes.
 * Criterios noul con true/false explícitos: true si el nuevo pedido depende gramatical
 * o contextualmente del anterior; false si es una orden autónoma que se entiende por sí sola.
 */
function buildContinuation(data: ContinuationInput): DecisionInput {
  const state = [
    `Previous request: ${data.previous.request}`,
    data.previous.answer ? `Previous answer: ${data.previous.answer}` : null,
    `New request: ${data.request}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      follow: {
        type: "noul",
        instructions:
          "Does the new request depend on the previous conversation to be understood (references, pronouns, ellipsis)?",
        criteria: {
          true: "Refers to the previous conversation using pronouns ('it', 'that', 'them'), 'also', 'and in...', or needs the previous result.",
          false: "Self-contained request that can be understood and executed completely on its own without context.",
        },
      },
    },
  };
}

const continuation_explicit_reference: Variant = {
  name: "continuation_explicit_reference",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};

export default continuation_explicit_reference;
