/**
 * eval/variants/d5/d5_v04.ts
 *
 * D5 (Completion Check) — variante v04 (Iteración 1 hard):
 * Hipótesis: En casos hard de D5, el modelo sufre de un sesgo positivo severo (prob=0.99)
 * cuando ve que una herramienta terminó con 'ok', ignorando que la orden pedía múltiples cosas o mover/eliminar
 * y la herramienta solo copió o hizo una parte.
 * v04 recalibra el criterio con una regla de escepticismo y verificación exhaustiva de todos los requisitos.
 */

import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import { COMPLETION_KEY } from "../../../src/core/contracts.ts";
import type { Variant } from "../../core/variants/types.ts";

const COMPLETION_CRITERIA = {
  true: "Every single requirement of REQUEST is completely fulfilled. For example, if 'Move' was requested, the source must be deleted or moved, not just copied.",
  false: "The request is incomplete: only a subset of steps was run, an action was partial (e.g. copied instead of moved), or further work is required. When in doubt, mark false.",
};

function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildCompletionCheck(data);
  const compQ = base.questions[COMPLETION_KEY];
  if (!compQ || compQ.type !== "noul") return base;

  return {
    ...base,
    questions: {
      [COMPLETION_KEY]: {
        ...compQ,
        instructions:
          "Carefully verify DONE against the entire original REQUEST. " +
          "Does DONE prove that EVERY clause and requirement is 100% completed? If anything was partially done or only copied instead of moved, answer false.",
        criteria: COMPLETION_CRITERIA,
      },
    },
  };
}

const d5_v04: Variant = {
  name: "d5_v04",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};
export default d5_v04;
