// Hipótesis: combinar la pregunta principal `request_complete` (con la pista "A copy is not a move." activada condicionalmente por `MOVE_STEP`, como en D4) con un detector invertido de faltantes (`missing_part`) bloquea falsos cierres cuando `missing_part` supera 0.25 sin sobrecargar la pregunta principal con múltiples reglas.

import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { COMPLETION_APPROVE, COMPLETION_KEY } from "../../core/contract.ts";
import { MOVE_STEP, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { ReadAnswer, Variant } from "../../core/variants/types.ts";

function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  const state = PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view });
  const requestLine = data.view.match(/^REQUEST:\s*(.+)$/m)?.[1] ?? "";
  const moveHint = MOVE_STEP.test(requestLine) ? " A copy is not a move." : "";

  return {
    state,
    questions: {
      [COMPLETION_KEY]: {
        type: "noul",
        instructions: `Using only what DONE shows, is every part of REQUEST already done? False if any part is missing or was never done.${moveHint}`,
        criteria: {
          true: "Every part of the REQUEST is done.",
          false: "Some part of the REQUEST is missing or not done yet.",
        },
      },
      missing_part: {
        type: "noul",
        instructions: `Is any specific part of REQUEST still undone in DONE (for example a missing file, item, save/write/delete action, or a copy instead of a move)?${moveHint}`,
        criteria: {
          true: "At least one requested part, target, or final action is still missing from DONE.",
          false: "Nothing requested in REQUEST is missing from DONE.",
        },
      },
    },
  };
}

function readD5(answers: Record<string, ReadAnswer>): { complete: boolean; probability: number } {
  const pComplete = answers[COMPLETION_KEY]?.noul ?? 0;
  const pMissing = answers.missing_part?.noul ?? 0;
  const probability = Math.min(pComplete, 1 - pMissing);
  return { complete: probability >= COMPLETION_APPROVE, probability };
}

const d5_complete_plus_gate: Variant = {
  name: "d5_complete_plus_gate",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: { d5: readD5 },
};

export default d5_complete_plus_gate;
