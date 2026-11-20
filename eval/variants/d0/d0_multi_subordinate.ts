import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * d0_multi_subordinate
 * Hipótesis: En d0, d3:2b confunde pedidos 'multi' con 'single' cuando la segunda acción
 * está subordinada a la primera (ej. "buscar X y guardar en Y").
 * Reforzar la pregunta 'multi' (noul) con criterios concretos de true/false para acciones enlazadas.
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
          chat: "Greeting, thanks or small talk. Nothing to look up, run, search or edit.",
          single: "One self-contained action: one lookup, one command, or reading one item.",
          multi: "Two or more actions, or one action whose output feeds another action (like search then save).",
        },
      },
      multi: {
        type: "noul",
        instructions:
          "Does the request ask for two or more separate steps, or an action whose output feeds into another step (for example find and save)?",
        criteria: {
          true: "The request requires two or more actions (search and save, create and write, or multi-step goals).",
          false: "The request asks for exactly one thing to do or find without follow-up actions.",
        },
      },
    },
  };
}

const d0_multi_subordinate: Variant = {
  name: "d0_multi_subordinate",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_multi_subordinate;
