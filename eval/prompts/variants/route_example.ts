/**
 * eval/prompts/variants/route_example.ts
 *
 * Variante de ejemplo para la etapa `route`. Demuestra:
 * - Edición de `instructions` (append).
 * - Edición de criterios (`remove` + `append`).
 * - `labelMap`: mapea la opción renombrada al nombre canónico.
 *
 * Sección 5.3.
 */

import type { Variant } from "../core/variants/types.ts";

const route_example: Variant = {
  name: "route_example",
  decision: {
    route: {
      // Añade una nota al final de las instrucciones de la pregunta `route`.
      questions: {
        route: {
          instructions: {
            append: "\n\nPrioritize web browsing if the user mentions searching or looking up.",
          },
          criteria: {
            // Elimina "fin" y agrega una opción renombrada "done" (alias de "fin").
            remove: ["fin"],
            append: { done: "Task is fully completed" },
          },
        },
      },
      // "done" en la respuesta del modelo se traduce al canónico "fin".
      labelMap: { done: "fin" },
    },
  },
};

export default route_example;

