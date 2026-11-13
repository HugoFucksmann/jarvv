/**
 * d4_keys_a: el D4 de prod (texto idéntico, incluida la frase de copiar/mover) con las preguntas renombradas: ok -> usable_data, cumple -> step_accomplished.
 * Solo cambian las claves; la lectura (`read`) las vuelve a mapear a ok y cumple para el grader.
 */

import type { VerifyDecisionInput } from "../../../src/core/contracts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const OK = "usable_data";
const CUMPLE = "step_accomplished";

function buildResultVerification(data: VerifyDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildResultVerification(data);
  return { state: base.state, questions: { [OK]: base.questions.ok, [CUMPLE]: base.questions.cumple } };
}

const d4_keys_a: Variant = {
  name: "d4_keys_a",
  prompts: { DECISION_PROMPTS: { buildResultVerification } },
  read: {
    result_verification: (answers) => ({ ok: answers[OK]?.noul ?? Number.NaN, cumple: answers[CUMPLE]?.noul ?? Number.NaN }),
  },
};

export default d4_keys_a;
