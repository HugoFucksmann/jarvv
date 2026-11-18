import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 1 - Variante B:
 * Choice categórico con 3 estados:
 * - `all_done`: Todo lo pedido en REQUEST fue completado con éxito.
 * - `partial_work`: Se hicieron llamadas preparatorias (lectura/búsqueda) pero falta el resultado final o cambio.
 * - `nothing_done`: No se avanzó o los intentos fallaron.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      status: {
        type: "choice",
        instructions: "Evaluate how much of REQUEST was accomplished in DONE.",
        criteria: {
          all_done: "Every part of REQUEST is 100% accomplished in DONE.",
          partial_work: "Some steps were done (e.g. read, listed, searched) but the final goal, write, or answer is missing.",
          nothing_done: "None of the user's requirements were accomplished or calls failed.",
        },
      },
    },
  };
}

const d5_it1_choice_triplet: Variant = {
  name: "d5_it1_choice_triplet",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const probs = answers.status?.probabilities ?? {};
      const pAll = probs.all_done ?? 0;
      const pPartial = probs.partial_work ?? 0;

      return {
        complete: pAll >= 0.65 && pAll > pPartial,
        probability: pAll,
      };
    },
  },
};

export default d5_it1_choice_triplet;
