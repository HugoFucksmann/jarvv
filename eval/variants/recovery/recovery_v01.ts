/**
 * eval/variants/recovery/recovery_v01.ts
 *
 * Variante `mode: "prompt"` de `recovery`.
 * Hipótesis: alinear los criterios de `rewrite_item`, `replan` y `close` con las señales observables de `Why it failed`
 * (`user_rejected`/`denied`/`repeat_blocked`/permisos/tests/apps/2+ intentos -> `close`; falta carpeta/CLI/puerto/formato -> `replan`;
 * 1er intento con error de sintaxis, flag, ruta o búsqueda -> `rewrite_item`) reduce confusión entre `rewrite_item` y `replan`.
 */

import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const cause = data.cause === null ? "unknown" : data.cause;
  const failedBlock = [
    "### THE STEP THAT JUST FAILED",
    `Item: ${safe(data.failed)}`,
    `Why it failed: ${cause}`,
    `Attempts so far: ${data.attempts}`,
    "Items after it: none",
  ].join("\n");

  return {
    state: `${PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view })}\n\n${failedBlock}`,
    questions: {
      [RECOVERY_KEY]: {
        type: "choice",
        instructions: "Choose the recovery action based on the failure details, cause, and attempts count:",
        criteria: {
          rewrite_item:
            "Single attempt (1 attempt) that failed due to fixable syntax (e.g. && or Unix command), wrong parameter/flag/mode, wrong file path when searchable, or narrow query. Retry.",
          replan:
            "Under 3 attempts and FAIL shows a missing prerequisite step: missing parent folder on write, port in use (EADDRINUSE), missing dev CLI/package/service, or unsupported format needing conversion. Rebuild plan.",
          close:
            "Cause is user_rejected/denied/repeat_blocked/no_tools, permission denied, failing tests/build, missing desktop app, corrupt/locked file, or 2+ failed attempts without progress. Stop.",
        },
      },
    },
  };
}

const recovery_v01: Variant = {
  name: "recovery_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_v01;
