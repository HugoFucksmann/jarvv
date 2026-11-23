/**
 * eval/variants/d5/d5_v2.ts
 *
 * Hipótesis: instruir explícitamente el cotejo ítem por ítem de REQUEST y USER contra DONE (incluyendo trampa de copiar vs mover y archivos/formatos) reduce cierres prematuros sin perder cierres condicionales válidos.
 */

import { COMPLETION_KEY } from "../../../src/core/contracts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const COMPLETE_INSTRUCTIONS =
  "Check every action, target file/format, and condition in REQUEST and USER against DONE (approved calls only). Answer true only if nothing requested remains undone (copying is not moving; conditional actions with empty match count as done).";

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
      [COMPLETION_KEY]: { ...q, instructions: COMPLETE_INSTRUCTIONS },
    },
  };
}

const d5_v2: Variant = {
  name: "d5_v2",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_v2;
