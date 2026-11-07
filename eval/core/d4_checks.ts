/**
 * eval/core/d4_checks.ts
 *
 * D4 (`result_verification`) con preguntas combinadas y `criteria` en las binarias. Compartido por las variantes `d4_*`; no toca
 * producción. Diseños tomados de las pruebas viejas (`conclusiones_old.md`): `criteria` explícito en la pregunta binaria
 * (quitó el sesgo a aprobar) y el veto dual AND de una clasificación en cuatro vías más la binaria con `criteria` ("J1", la
 * mejor de las viejas: peor caso malo 0,355 y 0 falsos positivos en 22 buenos).
 *
 * Regla de D4 (producción): aprueba solo si `ok` y `cumple` superan 0,5. Aquí `ok` y `cumple` se arman en código.
 */

import type { VerifyDecisionInput } from "../../src/core/engine/deps.ts";
import { DECISION_PROMPTS, type DecisionInput } from "../../src/core/reasoner/prompts.ts";
import type { ChoiceQ, NoulQ } from "./types.ts";

export const OK_WITH_CRITERIA: NoulQ = {
  type: "noul",
  instructions: "Is the result usable?",
  criteria: {
    true: "The result holds the data the step asks about, or (for an action that changes something) confirms that the action succeeded.",
    false: "The result is empty, an error message, or text unrelated to the step.",
  },
};

export const CUMPLE_WITH_CRITERIA: NoulQ = {
  type: "noul",
  instructions: "Does the result accomplish the step instruction?",
  criteria: {
    true: "Every part of the instruction is confirmed by the output: target, content and completeness. Nothing relies on assumption.",
    false: "At least one part of the instruction is contradicted by the output or the arguments, or is not confirmed by the output.",
  },
};

export const FOUR_WAY: ChoiceQ = {
  type: "choice",
  instructions: "Does the effect of the tool match the step instruction?",
  criteria: {
    matches:
      "The output confirms that the action was carried out on the target and with the content or amount the instruction names, including every specific detail it gives (names, versions, quantities, language). Nothing relies on assumption.",
    mismatch: "The action ran without an error, but the target, content, amount or language differs from what the instruction names, or only part of the instruction was done.",
    failed: "The output shows an error, an empty result, zero matches, or that nothing changed.",
    unconfirmed:
      "No error and no difference is visible, but the output does not say what happened (for example only a generic status such as 'started', 'sent' or 'ok'), so the effect cannot be confirmed.",
  },
};

/** Estado de producción con otras preguntas. */
export function withQuestions(data: VerifyDecisionInput, questions: DecisionInput["questions"]): DecisionInput {
  return { state: DECISION_PROMPTS.buildResultVerification(data).state, questions };
}

/**
 * J1: `ok` = 1 − P(failed) de la clasificación; `cumple` = el menor entre P(matches) y la binaria con `criteria` (veto AND:
 * un solo indicio de fallo basta para no aprobar).
 */
export function j1(answers: Record<string, { probabilities?: Record<string, number>; noul?: number }>): { ok: number; cumple: number } {
  const p = answers.effect?.probabilities ?? {};
  return { ok: 1 - (p.failed ?? 0), cumple: Math.min(p.matches ?? 0, answers.cumple?.noul ?? 0) };
}
