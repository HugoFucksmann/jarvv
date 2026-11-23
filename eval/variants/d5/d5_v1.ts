/**
 * eval/variants/d5/d5_v1.ts
 *
 * Hipótesis: reforzar en `criteria` de `complete` la verificación estricta de cada parte de REQUEST, formato/ruta pedida, acción exacta (mover ≠ copiar) y condiciones que ya quedaron descartadas al revisar mejora la precisión de cierre en Decisión 5.
 */

import { COMPLETION_KEY } from "../../../src/core/contracts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const COMPLETE_CRITERIA = {
  true: "DONE and USER show every required part of REQUEST was completed in the right path, format, and action (or a conditional check proved no action was needed).",
  false: "Any part of REQUEST or USER is still unexecuted, a wrong action was done (e.g. copy instead of move, wrong extension/file), or only the first step ran.",
};

function buildCompletionCheck(
  data: Parameters<typeof DECISION_PROMPTS.buildCompletionCheck>[0],
): DecisionInput {
  const base = DECISION_PROMPTS.buildCompletionCheck(data);
  const q = base.questions[COMPLETION_KEY];
  if (q?.type !== "noul") return base;
  return {
    ...base,
    questions: {
      ...base.questions,
      [COMPLETION_KEY]: { ...q, criteria: COMPLETE_CRITERIA },
    },
  };
}

const d5_v1: Variant = {
  name: "d5_v1",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_v1;
