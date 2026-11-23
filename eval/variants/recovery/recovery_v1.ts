/**
 * eval/variants/recovery/recovery_v1.ts
 *
 * Hipótesis: alinear los criterios de `action` con las señales reales de `recoveryRules.ts` (faltante de carpeta/herramienta/puerto/formato → `replan`, error de sintaxis o argumento en 1.º intento → `rewrite_item`, rechazos/permisos/tests o ≥2 intentos persistentes → `close`) mejora la discriminación entre `replan` y `rewrite_item`.
 */

import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const ACTION_CRITERIA: Record<string, string> = {
  rewrite_item:
    "First attempt (Attempts=1) with a fixable mistake in this step: typo, Unix command on Windows, && in PowerShell, missing write mode, wrong flag/filter, or isolated search/network miss.",
  replan:
    "Before retrying this step, a prerequisite is missing (parent folder does not exist on write, file must be found first, external program/package missing, port in use EADDRINUSE, unsupported format, read before edit).",
  close:
    "Hard stop: user_rejected, denied, repeat_blocked, no_tools, call_cap, permission denied, real failing tests/compiler errors, uninstalled desktop app, or 2+ persistent failures (network/disk/corrupt/locked/no_data).",
};

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
      [RECOVERY_KEY]: { ...act, criteria: ACTION_CRITERIA },
    },
  };
}

const recovery_v1: Variant = {
  name: "recovery_v1",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_v1;
