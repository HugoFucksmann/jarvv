/**
 * eval/variants/d0/d0_v01.ts
 *
 * D0 completa:
 * - kind (choice): chat, single, multi con definiciones explícitas para cada opción.
 * - multi (noul): true / false con definiciones simétricas completas.
 */

import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const KIND_CRITERIA: Record<string, string> = {
  chat: "Greeting, thanks, small talk, general conceptual knowledge, or questions about the assistant. Nothing to check on the computer or look up online.",
  single: "One action is enough: one web lookup for current or changing facts (prices, weather, latest versions, news), one command, one file operation, or opening one thing.",
  multi: "Two or more distinct actions, or chained steps where the output of one action feeds another (e.g. search or read and then save/write/convert/move).",
};

const MULTI_CRITERIA: { true: string; false: string } = {
  true: "The request asks for two or more different things to do or find (several items, or steps joined by 'and', 'then' or commas), or one action whose result feeds another action.",
  false: "The request asks for exactly one thing to do or find. Reading or looking something up and then telling the answer is still one action.",
};

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  const base = DECISION_PROMPTS.buildFirstQuery(data);
  const kindQ = base.questions.kind;
  const multiQ = base.questions.multi;
  if (kindQ.type !== "choice" || multiQ.type !== "noul") return base;

  return {
    ...base,
    questions: {
      kind: { ...kindQ, criteria: KIND_CRITERIA },
      multi: { ...multiQ, criteria: MULTI_CRITERIA },
    },
  };
}

const d0_v01: Variant = {
  name: "d0_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};
export default d0_v01;
