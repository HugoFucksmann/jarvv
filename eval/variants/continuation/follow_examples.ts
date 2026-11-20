import type { ContinuationInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * follow_examples
 * Criterios con ejemplos explícitos:
 * true: The new request needs the previous task to be understood: it refers to its result ("it", "that", "the first one", "also", "now") or is a short follow-up that leaves out the object ("and in the other one?", "and when?").
 * false: The new request says what to do and on what, in full, so it is understood without the previous task. A request that repeats the previous one, or is about the same topic, is false.
 */
function buildContinuation(data: ContinuationInput): DecisionInput {
  return {
    state: `Previous request: ${data.previous.request}\nPrevious answer: ${data.previous.answer}\nNew request: ${data.request}`,
    questions: {
      follow: {
        type: "noul",
        instructions:
          'Does the new request depend on the previous task: does it refer to it ("it", "that", "the first one", "also", "now") or need its result to be understood?',
        criteria: {
          true: 'The new request needs the previous task to be understood: it refers to its result ("it", "that", "the first one", "also", "now") or is a short follow-up that leaves out the object ("and in the other one?", "and when?").',
          false:
            "The new request says what to do and on what, in full, so it is understood without the previous task. A request that repeats the previous one, or is about the same topic, is false.",
        },
      },
    },
  };
}

const follow_examples: Variant = {
  name: "follow_examples",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};

export default follow_examples;
