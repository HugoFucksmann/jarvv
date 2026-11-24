/**
 * eval/variants/d5/d5_v05.ts
 *
 * D5 — variante v05 (Vuelta Manual 1):
 * Descubrimiento clave en los 23 fallos de v04:
 * Los fallos son TODOS condicionales no disparadas donde la tarea ESTÁ COMPLETA:
 * - "Si queda menos de 20 GB libres, borrá Temp" -> Hay 94 GB libres, la condición no se cumplió -> Tarea COMPLETA (true).
 * - "Si hay cambios en git, guardá diff" -> Working tree clean -> Tarea COMPLETA (true).
 * - "Fijate cómo está el modo oscuro y activalo si está apagado" -> dark_mode is currently on -> Tarea COMPLETA (true).
 * - "Si supera 5 MB pasalo a jpg" -> Pesa 1.2 MB -> Tarea COMPLETA (true).
 * - Tareas normales completadas (copió y después borró el original) -> Tarea COMPLETA (true).
 *
 * v05 incorpora explícitamente la regla de condicionales:
 * "If the request has a conditional action ('if X then do Y') and the observation shows the condition was NOT met,
 * the task is fully completed (true) because no further action is required."
 */

import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import { COMPLETION_KEY } from "../../../src/core/contracts.ts";
import type { Variant } from "../../core/variants/types.ts";

const COMPLETION_CRITERIA = {
  true: "The request is fully satisfied: either all requested actions were performed (e.g. copied and then deleted), OR a conditional clause ('if X then Y') was checked and the condition was not met (so no further action was needed).",
  false: "The request is incomplete: a required unconditional action was omitted, an action was only partially done (copied instead of moved), or a condition was met but the subsequent action was not executed.",
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
          "Is the entire REQUEST complete based on DONE? " +
          "Important conditional rule: If the request is conditional ('if X, do Y') and DONE shows condition X was evaluated and is FALSE (e.g. tree clean, dark mode already on, space sufficient), the task is COMPLETE (true). " +
          "If an unconditional step is missing or only copied instead of moved, answer false.",
        criteria: COMPLETION_CRITERIA,
      },
    },
  };
}

const d5_v05: Variant = {
  name: "d5_v05",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};
export default d5_v05;
