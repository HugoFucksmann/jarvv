/**
 * eval/variants/result_verification/result_verification_v03.ts
 *
 * Result Verification — variante v03.
 *
 * Resultado del eval:
 * - v01 ganó (+2.3%): mejoró `ok` (FN 2→1) sin regresiones.
 * - v02 retrocedió (−2.3%): sobrespecificó ok/cumple → FP en `ok` (FP 0→2).
 *
 * Hipótesis v03: partir de v01 (la mejor) y:
 * 1. Afinar `ok.true` para reducir el FN restante: el modelo rechaza resultados
 *    que "confirman éxito implícitamente" (sin mensaje explícito). Aclarar que
 *    la ausencia de error también cuenta como confirmación de éxito.
 * 2. Mantener `cumple` exactamente como en v01 (ya funciona bien, FP=1 FN=0).
 */

import type { VerifyDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const OK_CRITERIA = {
  // v03: aclarar que salida vacía-por-éxito (ej. comando que no imprime nada pero terminó ok)
  // también cuenta como usable. El FN que quedó en v01 era probablemente ese caso.
  true: "Contains valid usable data, confirms command success, or produced no output because the action completed silently without errors. An empty result is usable if no error or exception is present.",
  false: "Empty output WITH an error or exception, command syntax error, traceback, permission denied, or explicit failure message.",
};

const CUMPLE_CRITERIA = {
  true: "Fully and completely satisfies the step goal and expected outcome.",
  false: "Incomplete, only partial progress, failed to achieve target, or produced different outcome than expected.",
};

function buildResultVerification(data: VerifyDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildResultVerification(data);
  const q = { ...base.questions };

  if (q.ok && q.ok.type === "noul") {
    q.ok = {
      ...q.ok,
      instructions:
        "Does the result contain real usable data or confirm success? False if empty with errors, or if an exception or failure message is present.",
      criteria: OK_CRITERIA,
    };
  }

  if (q.cumple && q.cumple.type === "noul") {
    q.cumple = {
      ...q.cumple,
      instructions: "Does the call result fulfill the instruction and meet the expected outcome?",
      criteria: CUMPLE_CRITERIA,
    };
  }

  return { ...base, questions: q };
}

const result_verification_v03: Variant = {
  name: "result_verification_v03",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildResultVerification } },
};
export default result_verification_v03;
