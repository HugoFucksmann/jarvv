import type { FragmentJudgeInput, DecisionInput } from "../../../src/core/models/prompts.ts";
import type { DecisionQuestion } from "../../../src/core/types.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * fragment_judge_r1_facts_focused:
 * Instrucciones directas centradas en responder la pregunta objetivamente.
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
Does this passage contain specific facts or numbers that directly answer the QUESTION?`,
      criteria: {
        true: "The text provides facts, numbers, dates, or answers resolving the question.",
        false: "The text only mentions the topic without providing the requested information.",
      },
    };
  });
  return { state: `QUESTION: ${data.need}`, questions };
}

const fragment_judge_r1_facts_focused: Variant = {
  name: "fragment_judge_r1_facts_focused",
  prompts: { DECISION_PROMPTS: { buildFragmentJudge } },
};

export default fragment_judge_r1_facts_focused;
