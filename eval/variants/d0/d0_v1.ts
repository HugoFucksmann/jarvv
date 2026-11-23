/**
 * eval/variants/d0/d0_v1.ts
 *
 * Hipótesis: aclarar en `kind` que preguntas conceptuales o de capacidades son `chat` mientras hechos actuales o estado de la PC son `single` reduce falsos `chat` en consultas cortas.
 */

import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const KIND_INSTRUCTIONS =
  "Classify how many tool actions this request needs from an assistant that can inspect the PC, run commands, manage files, and search the web.";

const KIND_CRITERIA: Record<string, string> = {
  chat: "Greeting, thanks, small talk, or general/conceptual knowledge answerable without touching files, PC state, or live web facts.",
  single: "Exactly one tool action: one local file/folder/system check, one PC setting or media action, one command, or one web lookup (reading and reporting the answer is still single).",
  multi: "Two or more distinct actions, or chained steps where the output of one action feeds another (e.g. search or read and then save/write/convert/move).",
};

function buildFirstQuery(data: Parameters<typeof DECISION_PROMPTS.buildFirstQuery>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildFirstQuery(data);
  const kind = base.questions.kind;
  if (kind?.type !== "choice") return base;
  return {
    ...base,
    questions: {
      ...base.questions,
      kind: { ...kind, instructions: KIND_INSTRUCTIONS, criteria: KIND_CRITERIA },
    },
  };
}

const d0_v1: Variant = {
  name: "d0_v1",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};

export default d0_v1;
