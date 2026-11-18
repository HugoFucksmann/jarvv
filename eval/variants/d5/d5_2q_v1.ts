/**
 * D5 — Variante 1: 2 preguntas noul (all_done + no_pending).
 *
 * Reemplaza la única pregunta de prod por dos ángulos complementarios:
 *   - `all_done`: ¿Cada parte del REQUEST (targets, items de listas, acciones finales) aparece completa en DONE?
 *   - `no_pending`: ¿Hay alguna acción pedida que quedó a medias, solo se leyó sin guardar, o se copió en vez de mover?
 *     (semántica invertida: true = hay pendiente = malo)
 *
 * El reader combina: complete = all_done >= 0.75 AND no_pending < 0.4
 * La probabilidad reportada es all_done (la pregunta positiva).
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
          "Check each part of REQUEST against DONE: every target, every item of a list, the exact values written, and any final action (save, delete, move, report). Is every part of REQUEST fully done?",
        criteria: {
          true: "Every part of REQUEST is shown as done in DONE, with the right targets and values.",
          false: "A target, an item, a value, a save, a delete, or a final action is missing or not done yet.",
        },
      },
      no_pending: {
        type: "noul",
        instructions:
          "Is there any action in REQUEST that was only partially done: something read but not saved, copied instead of moved, started but not finished, or done for fewer items than requested?",
        criteria: {
          true: "Yes — something is half-done: read without saving, copy instead of move, or incomplete count.",
          false: "No — everything requested was fully carried out, nothing is left half-done.",
        },
      },
    },
  };
}

const d5_2q_v1: Variant = {
  name: "d5_2q_v1",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: {
    d5: (answers: Record<string, ReadAnswer>) => {
      const pAllDone = answers.all_done?.noul ?? 0;
      const pNoPending = answers.no_pending?.noul ?? 0; // alta = hay pendiente
      const complete = pAllDone >= 0.75 && pNoPending < 0.4;
      return { complete, probability: pAllDone };
    },
  },
};

export default d5_2q_v1;
