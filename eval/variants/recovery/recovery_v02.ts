/**
 * eval/variants/recovery/recovery_v02.ts
 *
 * Variante `mode: "prompt"` de `recovery`.
 * Hipótesis: destacar `Attempts so far` y resumir la naturaleza observable de cada opción en criterios ultra-cortos (sin
 * reglas negativas sobre nombres de opciones) ayuda al modelo 2B a distinguir "ajustar el mismo paso" vs "hacer otro paso antes" vs "parar".
 */

import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const cause = data.cause === null ? "unknown" : data.cause;
  const failedBlock = [
    "### FAILED STEP SUMMARY",
    `Failed item: ${safe(data.failed)}`,
    `Motor cause: ${cause}`,
    `Consecutive failed attempts: ${data.attempts}`,
  ].join("\n");

  return {
    state: `${PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view })}\n\n${failedBlock}`,
    questions: {
      [RECOVERY_KEY]: {
        type: "choice",
        instructions: "Pick the next action for the failed step using FAIL, Motor cause, and Consecutive failed attempts:",
        criteria: {
          rewrite_item: "1 attempt: same goal is reachable by fixing command syntax, tool flags, path lookup, or search phrasing.",
          replan: "A different prerequisite step is needed first (create missing folder, free occupied port, install missing dev tool/module, convert unsupported file).",
          close: "Stop when refused/denied, access denied, tests/build fail, desktop app missing, disk/file corrupt, or 2+ attempts failed.",
        },
      },
    },
  };
}

const recovery_v02: Variant = {
  name: "recovery_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};

export default recovery_v02;
