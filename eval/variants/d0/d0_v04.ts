/**
 * eval/variants/d0/d0_v04.ts
 *
 * D0 — variante v04 (Iteración 1 hard):
 * Hipótesis: Los fallos más comunes en hard fueron pedidos que mencionan URLs, puertos o
 * conceptos técnicos (CORS, localhost, EADDRINUSE) o preguntas sobre capacidades ("¿podés hacer X?"),
 * clasificados erróneamente como `single` o `multi`.
 * v04 define explícitamente:
 * 1) En `chat`: consultas conceptuales, explicaciones técnicas ("por qué pasa X", "qué significa error Y"),
 *    preguntas sobre capacidades o intenciones hipotéticas son SIEMPRE chat.
 * 2) En `single`: se debe requerir una acción real e inmediata en la máquina o web actual.
 */

import type { FirstQueryInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const KIND_CRITERIA: Record<string, string> = {
  chat: "Explanation, theory, meaning of errors/terms, conceptual questions (why does X happen, what does error Y mean), assistant capabilities (can you do X?), or small talk. No immediate real action to perform on the PC or lookup online.",
  single: "Perform one concrete real action right now: run one command, perform one file operation, open one thing, or do one live web lookup for current external facts.",
  multi: "Perform two or more distinct actions now, or chained steps where the output of one action feeds another (find and then edit, search and then save).",
};

const MULTI_CRITERIA: { true: string; false: string } = {
  true: "The request asks to perform two or more distinct actions or chained steps on the machine/web right now.",
  false: "The request asks for at most one action, or asks a purely conceptual/explanatory question with no real execution.",
};

function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  const base = DECISION_PROMPTS.buildFirstQuery(data);
  const kindQ = base.questions.kind;
  const multiQ = base.questions.multi;
  if (kindQ.type !== "choice" || multiQ.type !== "noul") return base;

  return {
    ...base,
    questions: {
      kind: {
        ...kindQ,
        instructions:
          "Does this request require executing real actions on the computer or web right now? " +
          "Explanatory questions, error diagnostics ('why CORS', 'what does error mean'), or capability inquiries are 'chat'.",
        criteria: KIND_CRITERIA,
      },
      multi: {
        ...multiQ,
        criteria: MULTI_CRITERIA,
      },
    },
  };
}

const d0_v04: Variant = {
  name: "d0_v04",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildFirstQuery } },
};
export default d0_v04;
