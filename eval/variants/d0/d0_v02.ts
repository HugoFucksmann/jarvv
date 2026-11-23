/**
 * eval/variants/d0/d0_v02.ts
 *
 * Hipótesis: Precisar en `multi` (y en `kind.criteria.multi`) que filtrar/resumir un solo origen es `false` mientras que comparar dos orígenes o encadenar descubrimiento + acción es `true` mejora la separación `single` vs `multi`.
 */

import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const MULTI_TRUE =
  "Two or more distinct actions, conditional branches, comparing two different files/topics, or one step whose output is needed for a second step (find then read/move, search then save, check local then check web).";
const MULTI_FALSE =
  "A single tool operation with filters or multiple parameters, or reading/looking up one thing and summarizing or answering in chat.";

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  const base = DECISION_PROMPTS.buildFirstQuery(data);
  const multiQ = base.questions.multi;
  if (multiQ.type !== "noul") return base;
  return {
    ...base,
    questions: {
      ...base.questions,
      multi: {
        ...multiQ,
        criteria: { true: MULTI_TRUE, false: MULTI_FALSE },
      },
    },
  };
}

const d0_v02: Variant = {
  name: "d0_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};
export default d0_v02;
