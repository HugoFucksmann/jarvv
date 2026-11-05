/**
 * eval/core/graders/final.ts
 *
 * Graders para la etapa FINAL.
 */

import type { FinalExpect, FinalOutput, Grader } from "../types.ts";
import { containsTerm } from "./common.ts";

export const FinalResponseGrader: Grader<FinalOutput, FinalExpect> = {
  name: "final_response",
  grade(output, expect, _ctx, col) {
    if (!output || !output.response || typeof output.response !== "string") {
      col.check("valid_final_response", false, "Salida no es un texto de respuesta válido.");
      return;
    }

    const text = output.response;

    // Las claves llevan índice: dos textos con el mismo prefijo ya no se pisan.
    (expect.mustContainFacts ?? []).forEach((fact, i) => {
      col.check(
        `fact_present_${i}`,
        containsTerm(text, fact),
        `Dato requerido ausente en la respuesta final: '${fact}'`,
      );
    });

    (expect.mustMentionEffects ?? []).forEach((effect, i) => {
      col.check(
        `effect_present_${i}`,
        containsTerm(text, effect),
        `Efecto requerido no mencionado: '${effect}'`,
      );
    });

    (expect.forbiddenHallucinations ?? []).forEach((bad, i) => {
      col.check(
        `no_hallucination_${i}`,
        !containsTerm(text, bad),
        `Se detectó alucinación prohibida en la respuesta: '${bad}'`,
      );
    });
  },
};
