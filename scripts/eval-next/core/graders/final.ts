/**
 * scripts/eval-next/core/graders/final.ts
 *
 * Graders para la etapa FINAL (FINAL_VIEW de producción).
 */

import type { Grader, FinalExpect, FinalOutput } from "../types.ts";

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const FinalResponseGrader: Grader<FinalOutput, FinalExpect> = {
  name: "final_response",
  grade(output, expect, _ctx, col) {
    if (!output || !output.response || typeof output.response !== "string") {
      col.check("valid_final_response", false, "Salida no es un texto de respuesta válido.");
      return;
    }

    const text = norm(output.response);

    if (expect.mustContainFacts && expect.mustContainFacts.length > 0) {
      for (const fact of expect.mustContainFacts) {
        const found = text.includes(norm(fact));
        col.check(
          `fact_present_${fact.slice(0, 15)}`,
          found,
          `Dato requerido ausente en la respuesta final: '${fact}'`
        );
      }
    }

    if (expect.mustMentionEffects && expect.mustMentionEffects.length > 0) {
      for (const effect of expect.mustMentionEffects) {
        const found = text.includes(norm(effect));
        col.check(
          `effect_present_${effect.slice(0, 15)}`,
          found,
          `Efecto requerido no mencionado: '${effect}'`
        );
      }
    }

    if (expect.forbiddenHallucinations && expect.forbiddenHallucinations.length > 0) {
      for (const bad of expect.forbiddenHallucinations) {
        const found = text.includes(norm(bad));
        col.check(
          `no_hallucination_${bad.slice(0, 15)}`,
          !found,
          `Se detectó alucinación prohibida en la respuesta: '${bad}'`
        );
      }
    }
  },
};

