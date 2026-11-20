import type { DecisionInput, FragmentJudgeInput } from "../../../src/core/models/prompts.ts";
import type { DecisionQuestion } from "../../../src/core/types.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * fragment_judge_direct_evidence
 * Hipótesis: En fragment_judge (gem1: 75%, gem_hard: 81.8%), d3:2b duda cuando el fragmento
 * contiene información factual que responde la necesidad pero con redacción indirecta.
 * Criterios noul con true/false explícitos: true si contiene hechos, números o afirmaciones que resuelven la consulta.
 */
function buildFragmentJudge(data: FragmentJudgeInput): DecisionInput {
  const questions: Record<string, DecisionQuestion> = {};
  data.fragments.forEach((fragment, i) => {
    questions[`f${i}`] = {
      type: "noul",
      instructions: `Does this fragment contain factual information that helps answer the information need?\n<fragment>\n${fragment}\n</fragment>`,
      criteria: {
        true: "Contains relevant facts, answers, dates, names, or data that directly address what is needed.",
        false: "Irrelevant, generic boilerplate, navigation text, or unrelated to the information need.",
      },
    };
  });

  return {
    state: `Information need: ${data.need}`,
    questions,
  };
}

const fragment_judge_direct_evidence: Variant = {
  name: "fragment_judge_direct_evidence",
  prompts: { DECISION_PROMPTS: { buildFragmentJudge } },
};

export default fragment_judge_direct_evidence;
