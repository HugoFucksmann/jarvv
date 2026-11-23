/**
 * eval/variants/recovery/recovery_v2.ts
 *
 * Hipótesis: guiar en `instructions` la comprobación en orden (causas de cierre duro → prerrequisitos faltantes → corrección local en intento 1) reduce falsos reintentos cuando falta una carpeta o hay EADDRINUSE/permiso denegado.
 */

import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const ACTION_INSTRUCTIONS =
  "Decide recovery from Why it failed, FAIL, and Attempts so far: close for user/policy/repeat blocks, permission denied, failing tests/build, or 2+ persistent failures; replan if a prerequisite is needed first (create folder, locate file, install tool/module, free EADDRINUSE port); rewrite_item on attempt 1 for fixable syntax, flags, or tool choice.";

function buildRecovery(
  data: Parameters<typeof DECISION_PROMPTS.buildRecovery>[0],
): DecisionInput {
  const base = DECISION_PROMPTS.buildRecovery(data);
  const act = base.questions[RECOVERY_KEY];
  if (act?.type !== "choice") return base;
  return {
    ...base,
    questions: {
      ...base.questions,
      [RECOVERY_KEY]: { ...act, instructions: ACTION_INSTRUCTIONS },
    },
  };
}

const recovery_v2: Variant = {
  name: "recovery_v2",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_v2;
