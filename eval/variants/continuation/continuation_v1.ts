/**
 * eval/variants/continuation/continuation_v1.ts
 *
 * Hipótesis: agregar `criteria` explícitos a `follow` aclarando que peticiones autocontenidas sobre el mismo tema o con 'ahora'/'también' + objeto completo son `false` reduce falsos seguimientos.
 */

import { CONTINUATION_KEY } from "../../core/contract.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const FOLLOW_CRITERIA = {
  true: "New request relies on the previous task to be understood: uses pronouns/ellipsis/ordinals ('it', 'that', 'the second', 'and in X?'), picks an offered option, asks why it failed, or acts on the prior result without naming it.",
  false: "New request is completely self-contained with its own full action and target (even if on a similar topic or starting with 'ahora'/'también'), or explicitly resets the topic.",
};

function buildContinuation(
  data: Parameters<typeof DECISION_PROMPTS.buildContinuation>[0],
): DecisionInput {
  const base = DECISION_PROMPTS.buildContinuation(data);
  const q = base.questions[CONTINUATION_KEY];
  if (q?.type !== "noul") return base;
  return {
    ...base,
    questions: {
      ...base.questions,
      [CONTINUATION_KEY]: { ...q, criteria: FOLLOW_CRITERIA },
    },
  };
}

const continuation_v1: Variant = {
  name: "continuation_v1",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};

export default continuation_v1;
