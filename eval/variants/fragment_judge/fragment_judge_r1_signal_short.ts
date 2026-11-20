import type { FragmentJudgeInput, DecisionInput } from "../../../src/core/models/prompts.ts";
import type { DecisionQuestion } from "../../../src/core/types.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * fragment_judge_r1_signal_short:
 * Criterios cortos y simples para el 2B.
 */
function buildFragmentJudge(data: FragmentJudgeInput): DecisionInput {
  const questions: Record<string, DecisionQuestion> = {};
  data.fragments.forEach((fragment: string, i: number) => {
    questions[`f${i}`] = {
      type: "noul",
      instructions: `PASSAGE:
"""
${fragment}
"""
Does the PASSAGE answer the QUESTION?`,
      criteria: {
        true: "Contains the answer to the question.",
        false: "Does not answer the question.",
      },
    };
  });
  return { state: `QUESTION: ${data.need}`, questions };
}

const fragment_judge_r1_signal_short: Variant = {
  name: "fragment_judge_r1_signal_short",
  prompts: { DECISION_PROMPTS: { buildFragmentJudge } },
};

export default fragment_judge_r1_signal_short;
