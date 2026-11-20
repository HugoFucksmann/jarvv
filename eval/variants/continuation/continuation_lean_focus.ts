import type { ContinuationDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * continuation_lean_focus
 * Hipótesis: En d3:2b, la instrucción original de prod ("Does the new request depend on the previous task...")
 * funciona bien pero carece de criterios true/false concretos.
 * Añadir criterios noul simétricos y ultra-claros para true y false sin palabras rebuscadas.
 */
function buildContinuation(data: ContinuationDecisionInput): DecisionInput {
  const state = [
    `Previous request: ${data.previousRequest}`,
    data.previousAnswer ? `Previous answer: ${data.previousAnswer}` : null,
    `New request: ${data.newRequest}`,
  ].filter(Boolean).join("\n");

  return {
    state,
    questions: {
      follow: {
        type: "noul",
        instructions:
          'Does the new request depend on the previous task: does it refer to it ("it", "that", "the first one", "also", "now") or need its result to be understood?',
        criteria: {
          true: "The request builds upon, refers to, or continues the previous task or its answer.",
          false: "The request is a brand new, independent task that does not need previous context.",
        },
      },
    },
  };
}

const continuation_lean_focus: Variant = {
  name: "continuation_lean_focus",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};

export default continuation_lean_focus;
