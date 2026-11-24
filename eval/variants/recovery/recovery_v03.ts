/**
 * eval/variants/recovery/recovery_v03.ts
 *
 * Recovery — variante v03.
 *
 * Resultado del eval:
 * - v01 ganó (+4.0%): criterios más explícitos, especialmente en hard_3 (+10%).
 * - v02 retrocedió (−2.0%, 11 regresiones): el tiebreaker "fix cabe en los args"
 *   fue demasiado estricto — casos que necesitaban rewrite_item pero con una
 *   corrección más amplia se clasificaron mal como close o replan.
 *
 * Hipótesis v03: partir de v01 y afinar dos puntos:
 * 1. `close` tiene la regla "2+ intentos → close" que prod ya tiene pero v01 la
 *    hace más explícita. Los fallos restantes de v01 sugieren que el modelo no
 *    aplica bien esta regla cuando el error parece fixable. Añadir "NUNCA rewrite
 *    si ya hay 2+ intentos" como regla imperativa.
 * 2. `replan` necesita más ejemplos concretos de cuando es la opción correcta
 *    (prerequisito ausente distinto de los argumentos del paso fallido).
 */

import type { RecoveryDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import { RECOVERY_KEY } from "../../../src/core/contracts.ts";
import type { Variant } from "../../core/variants/types.ts";

const RECOVERY_CRITERIA: Record<string, string> = {
  rewrite_item:
    "Exactly 1 attempt so far AND the error is a fixable typo, wrong flag, bad path format, or syntax mistake in this specific step. Retry with the corrected call.",
  replan:
    "A step that must run BEFORE this one is missing: install a dependency, create a parent directory, free a locked port, or convert a file to the required format. The fix requires adding a new step, not just changing arguments.",
  close:
    "2 or more attempts already made (ALWAYS close, even if the fix seems obvious), OR the error is structural: blocked access, denied permissions, service or file does not exist, or repeated test failures. Stop and report.",
};

function buildRecovery(data: RecoveryDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildRecovery(data);
  const recQ = base.questions[RECOVERY_KEY];
  if (!recQ || recQ.type !== "choice") return base;

  return {
    ...base,
    questions: {
      [RECOVERY_KEY]: {
        ...recQ,
        // Instrucción con la regla de intentos como imperativo explícito.
        instructions:
          "Choose the recovery action. RULE: if attempts ≥ 2, always choose 'close' regardless of the error type. Otherwise: fixable call error → rewrite_item; missing prerequisite step → replan; structural/persistent failure → close.",
        criteria: {
          ...recQ.criteria,
          ...RECOVERY_CRITERIA,
        },
      },
    },
  };
}

const recovery_v03: Variant = {
  name: "recovery_v03",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildRecovery } },
};
export default recovery_v03;
