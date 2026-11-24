/**
 * eval/variants/result_verification/result_verification_v02.ts
 *
 * Result Verification — variante v02:
 * - ok (noul): true / false
 * - cumple (noul): true / false
 *
 * Hipótesis: v01 afinó los criterios de ambas preguntas. El borde problemático que queda
 * es que `cumple` puede confundirse con `ok` cuando el resultado es usable pero incompleto
 * (p. ej. el comando devolvió datos pero de un subconjunto). v02 separa las instrucciones
 * más nítidamente: `ok` es un filtro de viabilidad técnica; `cumple` juzga si la
 * viabilidad implica éxito funcional respecto del objetivo del paso.
 */

import type { VerifyDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const OK_CRITERIA = {
  true: "Contains valid usable data or confirms command success without errors, exceptions, or fatal exits.",
  false: "Empty output, command syntax error, exception traceback, permission denied, or failure message.",
};

const CUMPLE_CRITERIA = {
  true: "Fully and completely satisfies the step goal and expected outcome — not just partially or for a subset.",
  false: "Incomplete, only partial progress, correct format but wrong scope, failed to achieve target, or produced a different outcome than expected.",
};

function buildResultVerification(data: VerifyDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildResultVerification(data);
  const q = { ...base.questions };

  if (q.ok && q.ok.type === "noul") {
    q.ok = {
      ...q.ok,
      // ok: filtro técnico puro — ¿el resultado es usable como dato?
      instructions: "Technical filter only: does the result contain real data or confirm success? Ignore whether it is complete or correct — just check that it is not empty, an error, or an exception.",
      criteria: OK_CRITERIA,
    };
  }

  if (q.cumple && q.cumple.type === "noul") {
    q.cumple = {
      ...q.cumple,
      // cumple: juicio funcional — ¿el resultado cumple el objetivo del paso, no solo que "algo salió"?
      instructions: "Functional check: assuming the result is usable, does it fully satisfy the step instruction and expected outcome? A partial result or one that covers only a subset is false.",
      criteria: CUMPLE_CRITERIA,
    };
  }

  return { ...base, questions: q };
}

const result_verification_v02: Variant = {
  name: "result_verification_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildResultVerification } },
};
export default result_verification_v02;
