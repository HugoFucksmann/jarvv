import type { ContinuationInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * follow_short
 * Instrucción y criterios concisos:
 * Instrucción: Does the new request depend on the previous task: does it refer to it or need its result to be understood?
 * true: The new request needs the previous task to be understood
 * false: The task does not need previous tasks to be carried out
 */
function buildContinuation(data: ContinuationInput): DecisionInput {
  return {
    state: `Previous request: ${data.previous.request}\nPrevious answer: ${data.previous.answer}\nNew request: ${data.request}`,
    questions: {
      follow: {
        type: "noul",
        instructions:
          "Does the new request depend on the previous task: does it refer to it or need its result to be understood?",
        criteria: {
          true: "The new request needs the previous task to be understood",
          false: "The task does not need previous tasks to be carried out",
        },
      },
    },
  };
}

const follow_short: Variant = {
  name: "follow_short",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};

export default follow_short;
