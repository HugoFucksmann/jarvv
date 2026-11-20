import type { FirstQueryInput } from "../../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import type { Variant } from "../../../core/variants/types.ts";

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions: "Determine if the request is a pure conversation or a task requiring tools.",
        criteria: {
          chat: "The request contains ONLY conversational elements (greetings, thanks, small talk) and NO requests for actions, lookups, commands, file operations, or data retrieval. If any tool use is implied, it is NOT chat.",
          single: "The request requires EXACTLY ONE action, lookup, command, file operation, or data retrieval. No sequential steps or multiple items.",
          multi: "The request requires TWO OR MORE actions, steps, items, or a sequence where one output feeds the next.",
        },
      },
      multi: {
        type: "noul",
        instructions: "Does this request ask for more than one thing to be done or found?",
        criteria: {
          true: "The request asks for multiple different things, steps joined by 'and'/'then', a list of items, or a sequence.",
          false: "The request asks for exactly ONE thing to do or find. Even if it involves reading and telling the answer, it is still one action.",
        },
      },
    },
  };
}

const auto_d0_20261119_224745_cs10_r2_b: Variant = {
  name: "auto_d0_20261119_224745_cs10_r2_b",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default auto_d0_20261119_224745_cs10_r2_b;
