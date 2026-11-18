// Hipótesis: reemplazar el `noul` binario de D5 por una pregunta `choice` de 4 opciones (`all_done`, `missing_step_or_item`, `wrong_action_or_copy`, `failed_or_nothing_useful`) obliga a `d3:2b` a separar tareas parciales y sustituciones de copiar-por-mover sin contaminar pedidos de solo lectura ni ramas condicionales que piden avisar si no existe.

import type { CompletionDecisionInput } from "../../../src/core/contracts.ts";
import { COMPLETION_APPROVE } from "../../core/contract.ts";
import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { ReadAnswer, Variant } from "../../core/variants/types.ts";

function buildCompletionCheck(data: CompletionDecisionInput): DecisionInput {
  return {
    state: PROMPTS.PENDING_VIEW.buildUserPrompt({ view: data.view }),
    questions: {
      completion_state: {
        type: "choice",
        instructions: "Using only what DONE shows, classify how completely DONE satisfies REQUEST.",
        criteria: {
          all_done:
            "Every requested target, item, count, and final change in REQUEST is done in DONE (including an 'if exists' check that returned False when REQUEST asked to notify/report).",
          missing_step_or_item:
            "At least one requested step, item, file, count, or web lookup from REQUEST is missing or only partially done in DONE.",
          wrong_action_or_copy:
            "Only read, listed, or copied when REQUEST asked to write, save, move, rename, or delete.",
          failed_or_nothing_useful:
            "A required call failed or DONE did not obtain what REQUEST asked for.",
        },
      },
    },
  };
}

function readD5(answers: Record<string, ReadAnswer>): { complete: boolean; probability: number } {
  const probability = answers.completion_state?.probabilities?.all_done ?? 0;
  return { complete: probability >= COMPLETION_APPROVE, probability };
}

const d5_choice_4opt: Variant = {
  name: "d5_choice_4opt",
  prompts: { DECISION_PROMPTS: { buildCompletionCheck } },
  read: { d5: readD5 },
};

export default d5_choice_4opt;
