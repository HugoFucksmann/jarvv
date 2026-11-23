/**
 * eval/core/graders/final.ts
 *
 * Graders para la etapa FINAL.
 */

import type { FinalExpect, FinalOutput, Grader } from "../types.ts";
import { containsTerm, findInternalLeak } from "./common.ts";

/** El prompt pide empezar directo con la respuesta, sin saludo. */
const GREETING_RE = /^[\s¡!¿?"'«*_#>-]*(?:hola|buen(?:os|as)|hello|hi|hey|saludos|estimad[oa])\b/i;

export const FinalResponseGrader: Grader<FinalOutput, FinalExpect> = {
  name: "final_response",
  grade(output, expect, _ctx, col) {
    if (!output?.response || typeof output.response !== "string") {
      col.check("valid_final_response", false, "Salida no es un texto de respuesta válido.");
      return;
    }

    const text = output.response;

    // Reglas del prompt de producción que valen para toda respuesta final, con o sin `expect`.
    const leak = findInternalLeak(text);
    col.check("no_internal_leaks", leak === undefined, `La respuesta filtra un término interno (herramienta, estado o id): '${leak}'`);
    col.check("no_greeting", !GREETING_RE.test(text), "La respuesta empieza con un saludo: debe empezar directo con la respuesta.");

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
