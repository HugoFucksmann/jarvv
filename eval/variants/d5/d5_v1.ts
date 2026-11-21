/**
 * eval/variants/d5/d5_v1.ts
 *
 * Variante dedicada para la etapa `d5` (`buildCompletionCheck`).
 * Evalúa estrictamente contra `DONE` si todas las subtareas, entregables y formatos de `REQUEST` están completos.
 */

import { COMPLETION_KEY, type CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { type DecisionInput, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      [COMPLETION_KEY]: {
        type: "noul",
        instructions:
          "Compare REQUEST against DONE strictly: is EVERY requested part, file output, conversion, cleanup, and verification actually finished?",
        criteria: {
          true: "Every explicit goal, target, and deliverable in REQUEST is verified complete in DONE.",
          false: "Any requested action is missing, only partially done (e.g., searched/read but not written/saved/moved), failed, or unverified.",
        },
      },
    },
  };
}

const d5_v1: Variant = {
  name: "d5_v1",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
};

export default d5_v1;
