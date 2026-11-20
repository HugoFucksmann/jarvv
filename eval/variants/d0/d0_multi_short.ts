import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * d0_multi_short
 * Instrucción y criterios cortos para multi:
 * Instrucción: Does the request ask for two or more separate actions?
 * true: The request asks for two or more different things to do or find
 * false: The request asks for exactly one thing to do or find
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
          chat: "Greeting, thanks or small talk. Nothing to look up or do.",
          single: "One action is enough: one lookup, one command, one file operation or opening one thing.",
          multi:
            "Two or more actions, or one action whose result is needed by another (for example search and then save).",
        },
      },
      multi: {
        type: "noul",
        instructions: "Does the request ask for two or more separate actions?",
        criteria: {
          true: "The request asks for two or more different things to do or find",
          false: "The request asks for exactly one thing to do or find",
        },
      },
    },
  };
}

const d0_multi_short: Variant = {
  name: "d0_multi_short",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_multi_short;
