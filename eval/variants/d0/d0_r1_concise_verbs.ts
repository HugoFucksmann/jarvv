import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * d0_r1_concise_verbs:
 * Versión concisa y directa orientada a los verbos de acción del pedido,
 * reduciendo el texto que debe procesar el 2B.
 */
function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions: "How many actions does this computer assistant request require?",
        criteria: {
          chat: "Small talk, greetings, thanks, or general conversation without tools.",
          single: "Exactly one operation or single factual query.",
          multi: "Two or more actions, piped steps, or multiple items to handle.",
        },
      },
      multi: {
        type: "noul",
        instructions: "Are there two or more separate steps to perform?",
        criteria: {
          true: "Two or more distinct actions or chained tasks.",
          false: "Only one action or single question.",
        },
      },
    },
  };
}

const d0_r1_concise_verbs: Variant = {
  name: "d0_r1_concise_verbs",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_r1_concise_verbs;
