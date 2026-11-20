import type { FirstQueryInput } from "../../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import type { Variant } from "../../../core/variants/types.ts";

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions: "How much work does this request need from an assistant with computer and web tools?",
        criteria: {
          chat: "Greeting, thanks, small talk, or general question needing NO tool lookup, file access, or system command. Purely conversational.",
          single: "One single action or lookup is enough (e.g., one search, one file op, one command).",
          multi: "Two or more separate actions where one feeds another, or multiple distinct items to process.",
        },
      },
      multi: {
        type: "noul",
        instructions: "Does this request require two or more separate actions?",
        criteria: {
          true: "Needs multiple actions or sequential steps.",
          false: "One single action is enough.",
        },
      },
    },
  };
}

const auto_d0_20261119_224745_cs10_r1_a: Variant = {
  name: "auto_d0_20261119_224745_cs10_r1_a",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default auto_d0_20261119_224745_cs10_r1_a;
