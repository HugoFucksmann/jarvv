// Hipótesis: dividir D5 en dos preguntas `noul` cortas y ortogonales (`all_targets_covered` y `requested_effect_done`) evita la confusión por cláusulas largas en `d3:2b`, detecta ítems parciales y copias en lugar de movimientos, y mantiene `true` en pedidos de solo lectura.

import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { COMPLETION_APPROVE } from "../../core/contract.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { ReadAnswer, Variant } from "../../core/variants/types.ts";

function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      all_targets_covered: {
        type: "noul",
        instructions:
          "Does DONE cover EVERY file, item, count, and sub-question asked in REQUEST (not just 1 of 2 files or 2 of 3 items)?",
        criteria: {
          true: "Every target, item, file, and sub-question in REQUEST is covered in DONE.",
          false: "At least one target, item, file, or sub-question in REQUEST is missing from DONE.",
        },
      },
      requested_effect_done: {
        type: "noul",
        instructions:
          "If REQUEST asks to write, save, create, move, rename, delete, or run something, does DONE confirm that exact change (a copy is not a move)? Answer true if REQUEST only asks to read, check, or inform (or an 'if exists' check was False).",
        criteria: {
          true: "Requested change is confirmed in DONE, or REQUEST only needed reading/checking/informing.",
          false: "Requested write, save, move, rename, delete, or run is missing, or only copied/read/listed.",
        },
      },
    },
  };
}

function readD5(answers: Record<string, ReadAnswer>): { complete: boolean; probability: number } {
  const pTargets = answers.all_targets_covered?.noul ?? 0;
  const pEffect = answers.requested_effect_done?.noul ?? 0;
  const probability = Math.min(pTargets, pEffect);
  return { complete: probability >= COMPLETION_APPROVE, probability };
}

const d5_2q_scope_effect: Variant = {
  name: "d5_2q_scope_effect",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: { d5: readD5 },
};

export default d5_2q_scope_effect;
