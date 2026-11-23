/**
 * eval/variants/result_verification/result_verification_v2.ts
 *
 * Hipótesis: reforzar en `instructions` de `cumple` el contraste contra `User input`, filtro/ordenamiento pedido y acción de mover vs copiar mejora la precisión sin perder claridad en `ok`.
 */

import { DECISION_PROMPTS, MOVE_STEP } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { VerifyCheckKey } from "../../../src/core/contracts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildResultVerification(
  data: Parameters<typeof DECISION_PROMPTS.buildResultVerification>[0],
): DecisionInput {
  const base = DECISION_PROMPTS.buildResultVerification(data);
  const c = data.criterion;
  const known = new Set(Object.keys(data.known ?? {}) as VerifyCheckKey[]);
  const questions = { ...base.questions };

  if (!known.has("ok") && questions.ok?.type === "noul") {
    questions.ok = {
      ...questions.ok,
      instructions:
        "Did the tool execution produce usable data or confirm completion without empty output, missing results, or errors?",
    };
  }
  if (!known.has("cumple") && questions.cumple?.type === "noul") {
    const moveHint = MOVE_STEP.test(c.instruction)
      ? " A copy is not a move or rename: if the original remains or a copy tool was used, answer false."
      : "";
    questions.cumple = {
      ...questions.cumple,
      instructions: `${c.expected ? "Does the Call result satisfy Step, Expected, and any User input constraints?" : "Does the Call result completely accomplish Step and any User input constraints?"}${moveHint}`,
    };
  }

  return { ...base, questions };
}

const result_verification_v2: Variant = {
  name: "result_verification_v2",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildResultVerification } },
};

export default result_verification_v2;
