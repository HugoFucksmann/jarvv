/**
 * eval/variants/result_verification/result_verification_v01.ts
 *
 * Result Verification completa:
 * - ok (noul): true / false
 * - cumple (noul): true / false
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
  true: "Fully and completely satisfies the step goal and expected outcome.",
  false: "Incomplete, only partial progress, failed to achieve target, or produced different outcome than expected.",
};

function buildResultVerification(data: VerifyDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildResultVerification(data);
  const q = { ...base.questions };

  if (q.ok && q.ok.type === "noul") {
    q.ok = {
      ...q.ok,
      instructions: "Does the result contain real usable data or confirm success? False if empty, error, or exception in output.",
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

  return {
    ...base,
    questions: q,
  };
}

const result_verification_v01: Variant = {
  name: "result_verification_v01",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildResultVerification } },
};
export default result_verification_v01;
