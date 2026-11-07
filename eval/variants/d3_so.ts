import { DECISION_PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Decisión 3 (`args_review`, d3:2b). Una sola palanca: decirle al revisor en qué sistema operativo corre la computadora.
 *
 * Hipótesis: en el eval de D3 lo que mejoró `d3_contraste` fue un comando de Linux en una máquina Windows
 * (`rev-linux-free-cmd`), y lo que se rompió fue un comando de Windows (`rev-cmd-tasklist`). Es una decisión que depende del
 * sistema operativo, y D3 no lo recibe. Se agrega `Platform: Windows` al estado (texto fijo, igual que `arguments`) y una
 * frase en la instrucción: un comando escrito para otro sistema operativo es `args_invalid`, no `tool_rejected`.
 *
 * Opciones, claves y orden: los de producción (sin `labelMap`). Solo cambia el estado y la instrucción.
 * Comparar contra prod y contra `d3_contraste`; si suma, probar `d3_so` con la prueba "¿otros valores?" en una variante aparte.
 */
const d3_so: Variant = {
  name: "d3_so",
  prompts: {
    DECISION_PROMPTS: {
      buildArgsReview: (data) => {
        const base = DECISION_PROMPTS.buildArgsReview(data);
        const review = base.questions.review;
        return {
          ...base,
          state: `${base.state}\nPlatform: Windows (commands run in PowerShell)`,
          questions: {
            review: {
              ...review,
              instructions: `${review.instructions} A command written for an operating system other than the Platform is a wrong argument (args_invalid), not a wrong tool.`,
            } as typeof review,
          },
        };
      },
    },
  },
};

export default d3_so;
