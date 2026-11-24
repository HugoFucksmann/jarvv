/**
 * eval/variants/continuation/continuation_v04.ts
 *
 * Continuation — variante v04 (Iteración 1 hard):
 * Hipótesis: En los casos hard, preguntas de seguimiento como "¿y qué tamaño tiene?" o "abrí el segundo archivo"
 * no fueron detectadas como continuación cuando la pregunta no usaba palabras obvias como "it/that", o bien
 * pedidos independientes con palabras similares fueron confundidos.
 * v04 define con precisión cuándo un pedido es elíptico / anafórico.
 */

import type { ContinuationInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const FOLLOW_CRITERIA = {
  true: "The new request depends on the previous task: it references previous entities (pronouns, ellipses like '¿y en D:?', ordinals 'el segundo', 'abrí ese archivo') or modifies/queries the previous outcome.",
  false: "The new request is completely self-contained: it specifies all required targets and actions independently, or starts a fresh unrelated topic.",
};

function buildContinuation(data: ContinuationInput): DecisionInput {
  const base = DECISION_PROMPTS.buildContinuation(data);
  const followQ = base.questions.follow;
  if (!followQ || followQ.type !== "noul") return base;

  return {
    ...base,
    questions: {
      follow: {
        ...followQ,
        instructions:
          "Does the new request require the previous request/answer context to be understood or performed? " +
          "True if it has ellipsis, references previous files/items without naming them fully, or builds on the previous output.",
        criteria: FOLLOW_CRITERIA,
      },
    },
  };
}

const continuation_v04: Variant = {
  name: "continuation_v04",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};
export default continuation_v04;
