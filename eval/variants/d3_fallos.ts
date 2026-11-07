import { DECISION_PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Decisión 3 (`args_review`, d3:2b). Solo cambia cómo se presenta el bloque "Failed attempts of this step". Las opciones
 * y sus claves son las de producción.
 *
 * Hipótesis (sesgo de "Failed attempts"): cada línea de ese bloque trae el `status` de un intento anterior (`tool_rejected`,
 * `args_invalid`…) con las mismas palabras que las opciones, y el 2b las copia o toma "hubo fallos" como razón para
 * rechazar la llamada actual. Dos cambios, solo cuando el bloque existe (sin fallos, el prompt es idéntico al de
 * producción):
 * - la etiqueta dice que es historia y que sus estados no son la respuesta;
 * - la instrucción pide juzgar solo la llamada candidata y rechazarla por repetir un intento anterior, no por haber fallado
 *   algo antes.
 *
 * Mide el efecto en casos con fallos previos y que el resto no se mueva (los casos sin fallos no cambian). Ver también
 * `d3_contraste` y `d3_completo`.
 */
const OLD_LABEL = "Failed attempts of this step:";
const NEW_LABEL = "Earlier failed attempts of this step (history only; their statuses are not the answer for the candidate call):";
const EXTRA =
  " Earlier failed attempts are history: judge only the candidate call. A past failure is not a reason to reject it, unless the candidate repeats the same arguments or the same mistake.";

const d3_fallos: Variant = {
  name: "d3_fallos",
  prompts: {
    DECISION_PROMPTS: {
      buildArgsReview: (data) => {
        const base = DECISION_PROMPTS.buildArgsReview(data);
        if (data.stepFailures.length === 0) return base;
        const review = base.questions.review;
        return {
          ...base,
          state: base.state.replace(OLD_LABEL, NEW_LABEL),
          questions: { review: { ...review, instructions: review.instructions + EXTRA } as typeof review },
        };
      },
    },
  },
};

export default d3_fallos;
