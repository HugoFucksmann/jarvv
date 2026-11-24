/**
 * eval/variants/d5/d5_v02.ts
 *
 * D5 (Completion Check) — variante v02:
 * - completion (noul): true / false
 *
 * Hipótesis: el prompt base tiene criterios muy escuetos ("Every part done" / "Some part missing").
 * v01 los amplió pero mantuvo la instrucción original. v02 cambia la instrucción para que el modelo
 * lea REQUEST como una checklist y verifique punto por punto en DONE, reduciendo falsos "true"
 * cuando la solicitud tiene varias partes y solo se cumplió la primera.
 */

import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import { COMPLETION_KEY } from "../../../src/core/contracts.ts";
import type { Variant } from "../../core/variants/types.ts";

const COMPLETION_CRITERIA = {
  true: "Every single part, constraint, and item of the original REQUEST is fully completed according to DONE.",
  false: "Any part of the REQUEST is missing, unfinished, failed, or still requires action.",
};

function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildCompletionCheck(data);
  const compQ = base.questions[COMPLETION_KEY];
  if (!compQ || compQ.type !== "noul") return base;

  return {
    ...base,
    questions: {
      [COMPLETION_KEY]: {
        ...compQ,
        // Nueva instrucción: tratar REQUEST como checklist y cruzarlo con DONE ítem a ítem.
        // Reduce falsos "true" cuando la solicitud tiene múltiples partes y solo se cumplió una.
        instructions:
          "Treat REQUEST as a checklist. For each item or constraint in REQUEST, check whether DONE shows it was completed. Answer true only if every item is crossed off. If any item is absent from DONE, answer false.",
        criteria: COMPLETION_CRITERIA,
      },
    },
  };
}

const d5_v02: Variant = {
  name: "d5_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};
export default d5_v02;
