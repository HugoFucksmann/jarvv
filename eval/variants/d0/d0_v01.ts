/**
 * eval/variants/d0/d0_v01.ts
 *
 * Hipótesis: Explicitar en `kind` que las preguntas de hechos actuales o cambiantes (versiones, precios, clima) son `single` (búsqueda web) y no `chat` reduce falsos `chat` sin afectar preguntas conceptuales.
 */

import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const KIND_CRITERIA: Record<string, string> = {
  chat: "Greeting, thanks, small talk, general conceptual knowledge, or questions about the assistant. Nothing to check on the computer or look up online.",
  single: "One action is enough: one web lookup for current or changing facts (prices, weather, latest versions, news), one command, one file operation, or opening one thing.",
};

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  const base = DECISION_PROMPTS.buildFirstQuery(data);
  const kindQ = base.questions.kind;
  if (kindQ.type !== "choice") return base;
  const criteria = Object.fromEntries(
    Object.entries(kindQ.criteria).map(([opt, text]) => [opt, KIND_CRITERIA[opt] ?? text]),
  );
  return {
    ...base,
    questions: {
      ...base.questions,
      kind: { ...kindQ, criteria },
    },
  };
}

const d0_v01: Variant = {
  name: "d0_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};
export default d0_v01;
