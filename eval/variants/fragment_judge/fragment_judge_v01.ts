/**
 * eval/variants/fragment_judge/fragment_judge_v01.ts
 *
 * Fragment Judge completa:
 * - f{i} (noul): true / false para cada fragmento evaluado.
 */

import type { DecisionInput, FragmentJudgeInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const FRAGMENT_CRITERIA = {
  true: "The passage states concrete facts that answer the question, even partially. If asking for current/latest info, facts must be current.",
  false: "The passage discusses unrelated topics, mentions keywords without answering, or provides outdated information superseded today.",
};

function buildFragmentJudge(data: FragmentJudgeInput): DecisionInput {
  const base = DECISION_PROMPTS.buildFragmentJudge(data);
  const questions = { ...base.questions };

  for (const [key, q] of Object.entries(questions)) {
    if (q.type === "noul") {
      questions[key] = {
        ...q,
        criteria: FRAGMENT_CRITERIA,
      };
    }
  }

  return {
    ...base,
    questions,
  };
}

const fragment_judge_v01: Variant = {
  name: "fragment_judge_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildFragmentJudge } },
};
export default fragment_judge_v01;
