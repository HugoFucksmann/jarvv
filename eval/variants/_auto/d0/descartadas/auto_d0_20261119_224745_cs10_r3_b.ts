import type { FirstQueryInput } from "../../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import type { Variant } from "../../../core/variants/types.ts";

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions: "Determine the nature of this request for an assistant with tools. Is it conversation, one task, or many tasks?",
        criteria: {
          chat: "This is NOT a task requiring any tool use. It is purely conversational (greetings, thanks, small talk) or subjective and does not need looking up, doing, finding, listing, or comparing anything.",
          single: "This requires EXACTLY ONE action/tool use (one command, one file op, one lookup). It is NOT a list, comparison, or multiple items.",
          multi: "This requires TWO OR MORE actions/tool uses. This includes lists of items, comparisons between things, sequential steps, or processing several separate things.",
        },
      },
      multi: {
        type: "noul",
        instructions: "Does this request involve multiple distinct operations (lists, comparisons, or sequential steps)?",
        criteria: {
          true: "The request involves listing items, comparing things, running multiple commands, or processing several separate pieces of information.",
          false: "The request is about doing exactly one thing. A single lookup, check, or command is not multiple.",
        },
      },
    },
  };
}

const auto_d0_20261119_224745_cs10_r3_b: Variant = {
  name: "auto_d0_20261119_224745_cs10_r3_b",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default auto_d0_20261119_224745_cs10_r3_b;
