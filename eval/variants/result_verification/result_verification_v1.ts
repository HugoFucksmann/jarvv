/**
 * eval/variants/result_verification/result_verification_v1.ts
 *
 * Hipótesis: aclarar en `criteria` que `ok` evalúa si hubo datos útiles o éxito técnico, mientras `cumple` exige coincidencia exacta con el objetivo, ubicación y formato pedido en Step/Expected/User input, reduce falsos positivos en copias/rutas equivocadas.
 */

import { DECISION_PROMPTS, MOVE_STEP } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { VerifyCheckKey } from "../../../src/core/contracts.ts";
import type { Variant } from "../../core/variants/types.ts";

const OK_CRITERIA = {
  true: "Output shows real non-empty data relevant to the call, or confirms the requested change succeeded with no error.",
  false: "Output is empty, '(no output)', 'Empty directory', an error/exception, not_found, no_data, or timeout.",
};

const CUMPLE_CRITERIA = {
  true: "Matches the requested path, filters, fields, action type (e.g. move vs copy), and User input refinements.",
  false: "Missing requested details, wrong path/action, truncated without full answer, or failed.",
};

function buildResultVerification(
  data: Parameters<typeof DECISION_PROMPTS.buildResultVerification>[0],
): DecisionInput {
  const base = DECISION_PROMPTS.buildResultVerification(data);
  const c = data.criterion;
  const known = new Set(Object.keys(data.known ?? {}) as VerifyCheckKey[]);
  const questions = { ...base.questions };

  if (!known.has("ok") && questions.ok?.type === "noul") {
    questions.ok = { ...questions.ok, criteria: OK_CRITERIA };
  }
  if (!known.has("cumple") && questions.cumple?.type === "noul") {
    const moveHint = MOVE_STEP.test(c.instruction) ? " A copy is not a move." : "";
    questions.cumple = {
      ...questions.cumple,
      instructions: `${c.expected ? "Does the result meet Expected?" : "Does the result accomplish Step?"}${moveHint}`,
      criteria: CUMPLE_CRITERIA,
    };
  }

  return { ...base, questions };
}

const result_verification_v1: Variant = {
  name: "result_verification_v1",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildResultVerification } },
};

export default result_verification_v1;
