/**
 * eval/variants/continuation/continuation_v03.ts
 *
 * Continuation — variante v03.
 *
 * Resultado del eval:
 * - v02 ganó (+5.2%, 0 regresiones): añadir dependencia semántica funcionó.
 * - v01 empató con prod: los pronombres como única señal no bastan.
 * - Casos restantes que fallan (3): cont-h2h-43, cont-h2h-48, cont-h2h-56.
 *   Hipótesis: son casos donde el nuevo pedido parece autónomo pero usa el RESULTADO
 *   de la tarea anterior como input implícito (sin mencionarlo).
 *
 * Hipótesis v03: partir de v02 y añadir una señal de CAMBIO DE TEMA como desempate
 * para falsos negativos: si el nuevo pedido CAMBIA completamente de dominio/objeto
 * → false; si opera sobre lo mismo → true. Esto ancla la independencia en términos
 * de objeto/dominio, no solo en sintaxis.
 */

import type { ContinuationInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const FOLLOW_CRITERIA = {
  true: 'The new request refers to the previous task (using pronouns like "it", "that", "also", "now", or implying the previous result) OR cannot be understood or executed without knowing the previous answer OR operates on the same object, file, or subject as the previous task.',
  false:
    "The new request is fully self-contained, can be understood and executed without any knowledge of the previous task, AND switches to a completely different object or domain.",
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
        // Instrucción de v02 + señal de cambio de dominio/objeto.
        instructions:
          'Does the new request depend on the previous task? Answer true if: (a) it refers to it ("it", "that", "also", "now", or similar); OR (b) it cannot be fully understood without the previous answer; OR (c) it operates on the same object, file, or subject. Answer false only if it is completely independent AND switches to a different topic.',
        criteria: FOLLOW_CRITERIA,
      },
    },
  };
}

const continuation_v03: Variant = {
  name: "continuation_v03",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildContinuation } },
};
export default continuation_v03;
