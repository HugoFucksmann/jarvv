import type { VerifyDecisionInput } from "../../src/core/engine/deps.ts";
import { DECISION_PROMPTS, type DecisionInput } from "../../src/core/reasoner/prompts.ts";
import type { ChoiceQ, NoulQ } from "../core/types.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Elección de 5 vías con granularidad explícita:
 * 1. exact_match: éxito en el objetivo y contenido exactos.
 * 2. wrong_target: ejecutó bien, pero sobre otro archivo, carpeta, subcarpeta o variante ortográfica/plural.
 * 3. wrong_content_or_quantity: ejecutó sobre el objetivo, pero el contenido, ubicación interna o cantidad difiere.
 * 4. failed: error, excepción, archivo no encontrado o resultado vacío.
 * 5. unconfirmed: resultado genérico sin detalles suficientes.
 */
const FIVE_WAY_CHOICE: ChoiceQ = {
  type: "choice",
  instructions: "Which statement best describes the outcome of the executed call relative to the instruction?",
  criteria: {
    exact_match: "The action succeeded on the exact target and fulfilled all specified contents, placements, and quantities.",
    wrong_target: "The action ran, but on a different path, folder, subfolder, file, or singular/plural variation.",
    wrong_content: "The target matches, but the content written/read, quantity, or specific details differ from what was requested.",
    failed: "The tool failed, returned an error, found nothing, or made no changes.",
    unconfirmed: "The output gives only a generic status without confirming the target or content.",
  },
};

const CUMPLE_BINARY: NoulQ = {
  type: "noul",
  instructions: "Does the result completely and accurately satisfy the step instruction?",
  criteria: {
    true: "Every requirement in the step instruction is confirmed by the output without assumptions.",
    false: "At least one requirement (target path, content, quantity, placement) is missing, altered, or failed.",
  },
};

function combineFiveWay(answers: Record<string, { probabilities?: Record<string, number>; noul?: number }>): { ok: number; cumple: number } {
  const p = answers.outcome?.probabilities ?? {};
  const failedProb = p.failed ?? 0;
  const ok = 1 - failedProb;

  const exactMatch = p.exact_match ?? 0;
  const binaryCumple = answers.cumple?.noul ?? 0;

  // Un solo indicio de target erróneo o contenido erróneo debe penalizar:
  const mismatchSignal = (p.wrong_target ?? 0) + (p.wrong_content ?? 0);

  // Veto si mismatchSignal es significativo o si binaryCumple es bajo
  const cumple = mismatchSignal > 0.35 || binaryCumple < 0.50 || exactMatch < 0.40
    ? Math.min(exactMatch, binaryCumple)
    : (exactMatch + binaryCumple) / 2;

  return { ok, cumple };
}

const d4_five_way: Variant = {
  name: "d4_five_way",
  prompts: {
    DECISION_PROMPTS: {
      buildResultVerification: (data: VerifyDecisionInput): DecisionInput => {
        return {
          state: DECISION_PROMPTS.buildResultVerification(data).state,
          questions: {
            outcome: FIVE_WAY_CHOICE,
            cumple: CUMPLE_BINARY,
          },
        };
      },
    },
  },
  decision: {
    result_verification: {
      combineVerification: combineFiveWay,
    },
  },
};

export default d4_five_way;

