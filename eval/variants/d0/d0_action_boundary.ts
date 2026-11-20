import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * d0_action_boundary
 * Hipótesis: En d0 (dev2: 10 casos chat predichos como single, 6 multi predichos como single),
 * clarificar qué es charla social/opinión pura vs qué requiere invocar herramientas en la computadora o web,
 * y en 'multi' reforzar que dos acciones conectadas o encadenadas exigen multi.
 * Ambas preguntas ('kind' choice y 'multi' noul) tienen criterios exhaustivos para true y false.
 */
function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions:
          "How much work does this request need from an assistant that can use tools on the computer and the web?",
        criteria: {
          chat: "Greeting, casual conversation, thanks, personal opinions, or explanations that require no tools or system access.",
          single: "Exactly one concrete action is enough: one command, one lookup, reading one item, or opening one app.",
          multi: "Two or more distinct actions, or steps where one action's output is saved, transformed, or used by another.",
        },
      },
      multi: {
        type: "noul",
        instructions:
          "Does the request ask for two or more separate actions (for example search and then save, or multiple different tasks)?",
        criteria: {
          true: "The request asks for multiple steps (such as finding and saving, inspecting and editing, or items joined by 'and'/'then'), or chained actions.",
          false: "The request asks for a single self-contained action, simple chat response, or looking up one fact without subsequent actions.",
        },
      },
    },
  };
}

const d0_action_boundary: Variant = {
  name: "d0_action_boundary",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_action_boundary;
