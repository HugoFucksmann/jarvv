/**
 * D5 — Variante 2: 2 preguntas noul con wording más granular y foco en "acciones finales".
 *
 * Mismo esquema que v1 (all_done + no_pending) pero con distinta formulación:
 *   - `all_done`: énfasis en que "buscar/leer" sin guardar no cuenta como hecho
 *   - `no_pending`: énfasis en detectar copias en lugar de movimientos, y conteos parciales
 *
 * El reader usa el mismo criterio: complete = all_done >= 0.75 AND no_pending < 0.4.
 */

import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { ReadAnswer, Variant } from "../../core/variants/types.ts";

function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      all_done: {
        type: "noul",
        instructions:
          "Using only what DONE shows: does every part of REQUEST appear as a completed action in DONE? Note: finding or reading something is not the same as saving, writing, or reporting it.",
        criteria: {
          true: "Every requested action (write, save, delete, move, report) is confirmed done in DONE.",
          false: "Some part of REQUEST is missing: a file not saved, an action not done, or a step only read without writing.",
        },
      },
      no_pending: {
        type: "noul",
        instructions:
          "Look at DONE and REQUEST together: is any requested action incomplete — for example a file copied instead of moved, fewer items processed than requested, or a task started but not confirmed finished?",
        criteria: {
          true: "Something is incomplete: copy instead of move, partial count, or unconfirmed finish.",
          false: "Everything in REQUEST was fully completed as shown in DONE.",
        },
      },
    },
  };
}

const d5_2q_v2: Variant = {
  name: "d5_2q_v2",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const pAllDone = answers.all_done?.noul ?? 0;
      const pNoPending = answers.no_pending?.noul ?? 0;
      const complete = pAllDone >= 0.75 && pNoPending < 0.4;
      return { complete, probability: pAllDone };
    },
  },
};

export default d5_2q_v2;
