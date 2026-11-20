import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * d0_chat_strict
 * Hipótesis: En d0, d3:2b confunde preguntas fácticas ("¿cuál es la capital de...?", "¿qué hora es?")
 * con 'chat'. Aclarar que 'chat' es únicamente interacción social o cortesía sin necesidad de búsqueda.
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
          chat: "Social greetings, pleasantries, small talk, or expressing gratitude. No external information needed.",
          single: "One action or looking up one piece of information, running one command, or opening one file.",
          multi: "Two or more actions, or one action whose result is needed by another action.",
        },
      },
      multi: {
        type: "noul",
        instructions:
          "Does the request ask for two or more separate actions (for example search and then save, or two different things to find)?",
        criteria: {
          true: "The request asks for two or more different things to do or find, or steps where one feeds another.",
          false: "The request asks for exactly one thing to do or find.",
        },
      },
    },
  };
}

const d0_chat_strict: Variant = {
  name: "d0_chat_strict",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_chat_strict;
