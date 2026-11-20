import type { DecisionInput, FragmentJudgeInput } from "../../../src/core/models/prompts.ts";
import type { DecisionQuestion } from "../../../src/core/types.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * fragment_judge_calibrated_signal
 * Hipótesis: Mantener el formato conciso de producción pero agregando criterios noul
 * simétricos para true y false que eviten falsos negativos sin generar ruido en runtime.
 */
function buildFragmentJudge(data: FragmentJudgeInput): DecisionInput {
  const questions: Record<string, DecisionQuestion> = {};
  data.fragments.forEach((fragment, i) => {
    questions[`f${i}`] = {
      type: "noul",
      instructions: `Does this fragment help answer the information need?\n<fragment>\n${fragment}\n</fragment>`,
      criteria: {
        true: "The text contains useful information, facts, or data answering what was asked.",
        false: "The text does not contain useful information or is irrelevant to the question.",
      },
    };
  });

  return {
    state: `Information need: ${data.need}`,
    questions,
  };
}

const fragment_judge_calibrated_signal: Variant = {
  name: "fragment_judge_calibrated_signal",
  prompts: { DECISION_PROMPTS: { buildFragmentJudge } },
};

export default fragment_judge_calibrated_signal;
