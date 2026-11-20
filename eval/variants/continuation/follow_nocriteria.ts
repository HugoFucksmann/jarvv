import type { ContinuationInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * follow_nocriteria
 * La pregunta de producción para continuation, sin criterios.
 */
function buildContinuation(data: ContinuationInput): DecisionInput {
  return {
    state: `Previous request: ${data.previous.request}\nPrevious answer: ${data.previous.answer}\nNew request: ${data.request}`,
    questions: {
      follow: {
        type: "noul",
        instructions:
          'Does the new request depend on the previous task: does it refer to it ("it", "that", "the first one", "also", "now") or need its result to be understood?',
      },
    },
  };
}

const follow_nocriteria: Variant = {
  name: "follow_nocriteria",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};

export default follow_nocriteria;
