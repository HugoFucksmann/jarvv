import type { FragmentJudgeInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { DecisionQuestion } from "../../../src/core/types.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * fragment_judge_signal_clean
 * Hipótesis: Conservar exactamente el prompt de producción (que rinde 87.5% en runtime y 100% en gem2)
 * y añadir criterios noul simétricos que guíen al modelo de 2B sin sobrecargar su atención.
 */
function buildFragmentJudge(data: FragmentJudgeInput): DecisionInput {
  const questions: Record<string, DecisionQuestion> = {};
  data.fragments.forEach((fragment, i) => {
    questions[`f${i}`] = {
      type: "noul",
      instructions: `Does this fragment help answer the information need?\n<fragment>\n${fragment}\n</fragment>`,
      criteria: {
        true: "Contains information or clues answering the information need.",
        false: "Completely irrelevant or unhelpful to the information need.",
      },
    };
  });

  return {
    state: `Information need: ${data.need}`,
    questions,
  };
}

const fragment_judge_signal_clean: Variant = {
  name: "fragment_judge_signal_clean",
  prompts: { DECISION_PROMPTS: { buildFragmentJudge } },
};

export default fragment_judge_signal_clean;
