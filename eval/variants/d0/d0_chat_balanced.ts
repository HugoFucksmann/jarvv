import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * d0_chat_balanced
 * Hipótesis: En d0, retener exactamente los criterios de 'single' y 'multi' de producción
 * (que demostraron ser los más robustos en 240+ casos de dev), y únicamente calibrar 'chat'
 * para separar charla social de preguntas que requieren datos del sistema o web.
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
          chat: "Greeting, thanks, pleasantries, or casual conversation without needing tools, facts or files.",
          single: "One action is enough: one lookup, one command, one file operation or opening one thing.",
          multi: "Two or more actions, or one action whose result is needed by another (for example search and then save).",
        },
      },
      multi: {
        type: "noul",
        instructions:
          "Does the request ask for two or more separate actions (for example search and then save, or two different things to find)?",
        criteria: {
          true: "The request asks for two or more different things to do or find (several items, or steps joined by 'and', 'then' or commas), or one action whose result feeds another action.",
          false: "The request asks for exactly one thing to do or find. Reading or looking something up and then telling the answer is still one action.",
        },
      },
    },
  };
}

const d0_chat_balanced: Variant = {
  name: "d0_chat_balanced",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_chat_balanced;
