import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { COMPLETION_KEY } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * d5_evidence_strict
 * Hipótesis: En d5 (cierre reactivo), prod aprueba pedidos cuando DONE tiene datos parciales
 * y duda en aprobaciones completas.
 * Al fijar la instrucción y criterios noul estrictamente sobre la correspondencia 1 a 1
 * entre todas las partes de REQUEST y lo verificado en DONE, se reducen falsos positivos.
 */
function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      [COMPLETION_KEY]: {
        type: "noul",
        instructions:
          "Based strictly on what DONE explicitly confirms, is every requirement and deliverable requested in REQUEST fully satisfied?",
        criteria: {
          true: "All tasks, files, searches, or actions asked in REQUEST are fully and explicitly completed in DONE.",
          false: "Any part of REQUEST is unfinished, pending, missing, or only partially done in DONE.",
        },
      },
    },
  };
}

const d5_evidence_strict: Variant = {
  name: "d5_evidence_strict",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_evidence_strict;
