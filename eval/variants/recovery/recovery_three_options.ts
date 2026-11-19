import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
import { PROMPTS, safe } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Hipótesis: una sola pregunta de tres opciones (`rewrite_item`, `replan`, `close`), criterios cortos, vista completa. Es la base de las demás.
 * Sin `skip_continue` ni `independent`: se mide con los datasets `recovery_n1` a `recovery_n4` (nunca con `recovery_casos`, `recovery2` ni `recovery3`, que tienen `skip_continue`). Resultados y descartes: `eval/GUIA_DECISION.md`, sección 5.
 */
function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const behind = data.behind.length > 0 ? data.behind.map((item, i) => `${i + 1}) ${safe(item)}`).join(" ") : "none";
  const cause = data.cause === null ? "unknown" : data.cause;
  const failedBlock = ["### THE STEP THAT JUST FAILED", `Item: ${safe(data.failed)}`, `Why it failed: ${cause}`, `Attempts so far: ${data.attempts}`, `Items after it: ${behind}`].join("\n");
  return {
    state: `${PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view })}

${failedBlock}`,
    questions: {
      [RECOVERY_KEY]: {
        type: "choice",
        instructions: "Choose the recovery action based on the failure reason, attempts count, and pending items:",
        criteria: {
          rewrite_item: "First attempt (1 attempt) with a fixable command, parameter, format, or typo on this step. Retry.",
          replan: "A prerequisite step or dependency is missing first (install package, create folder, free port, convert format). Rebuild plan.",
          close: "The item cannot be completed (persistent error, blocked, denied, or 2+ attempts), or no items remain. Stop.",
        },
      },
    },
  };
}

const recovery_three_options: Variant = { name: "recovery_three_options", prompts: { DECISION_PROMPTS: { buildRecovery } } };
export default recovery_three_options;
