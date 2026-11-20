import type { FirstQueryInput } from "../../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../../src/core/models/prompts.ts";
import type { Variant } from "../../../core/variants/types.ts";

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      multi: {
        type: "noul",
        instructions: "Is this one thing or multiple things?",
        criteria: {
          true: "Multiple distinct actions or items.",
          false: "Exactly one action or item.",
        },
      },
      kind: {
        type: "choice",
        instructions: "Classify the request:",
        criteria: {
          chat: "No tools needed (chat only).",
          single: "One tool/action needed.",
          multi: "Multiple tools/actions needed.",
        },
      },
    },
  };
}

const auto_d0_20261119_224745_cs10_r1_b: Variant = {
  name: "auto_d0_20261119_224745_cs10_r1_b",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default auto_d0_20261119_224745_cs10_r1_b;
