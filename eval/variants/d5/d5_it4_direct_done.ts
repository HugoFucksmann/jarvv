import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant, ReadAnswer } from "../../core/variants/types.ts";

/**
 * Iteración 4 - Variante A:
 * Pregunta directa choice binaria con instrucciones ultra-específicas sobre tareas completadas
 * 'done' vs 'unfinished' con calibración probabilística en 0.50.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      is_done: {
        type: "choice",
        instructions: "Is the user request in REQUEST completely solved by what was done in DONE?",
        criteria: {
          done: "Everything requested is done and solved. No more actions needed.",
          unfinished: "Not done yet. Missing an action, calculation, or write step.",
        },
      },
    },
  };
}

const d5_it4_direct_done: Variant = {
  name: "d5_it4_direct_done",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const probs = answers.is_done?.probabilities ?? {};
      const pDone = probs.done ?? 0;
      const pUnfinished = probs.unfinished ?? 0;

      return {
        complete: pDone > pUnfinished && pDone >= 0.52,
        probability: pDone,
      };
    },
  },
};

export default d5_it4_direct_done;

