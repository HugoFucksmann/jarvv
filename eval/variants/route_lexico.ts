import { DECISION_PROMPTS } from "../../src/core/reasoner/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Decisión 1 (`route`, d3:2b). Solo cambia la instrucción de la pregunta; las rutas, sus descripciones y su orden son los
 * de producción: no hace falta `labelMap`.
 *
 * Hipótesis (sesgo léxico): el modelo elige la ruta cuyo nombre aparece en el texto en vez de la que hace la acción. Dos
 * fuentes en el estado: (1) el paso nombra cosas ("archivo", "web", "precio") que no son la ruta a usar; (2) las líneas de
 * `Done` y `Attempts not approved` empiezan con `ruta/herramienta`, que el modelo toma como pista para repetir esa ruta.
 * La instrucción pide elegir por el tipo de acción a ejecutar ahora y declara que los nombres de ruta de esas listas son
 * historia, no una sugerencia.
 *
 * Mide con `decision_discriminating` (la respuesta correcta no es la primera opción) y los casos de `route` por escenario.
 * Siguiente paso si funciona: lo mismo para D2 (`tool_choice`), que tiene el mismo problema con los nombres de herramienta.
 */
const route_lexico: Variant = {
  name: "route_lexico",
  prompts: {
    DECISION_PROMPTS: {
      buildRouteChoice: (data) => {
        const base = DECISION_PROMPTS.buildRouteChoice(data);
        const route = base.questions.route;
        return {
          ...base,
          questions: {
            route: {
              ...route,
              instructions:
                "Which route should handle the next action? Choose by the kind of action to perform now, not by words that appear in the step. Route names inside the Done and Attempts lines are history, not a hint to repeat or avoid a route.",
            } as typeof route,
          },
        };
      },
    },
  },
};

export default route_lexico;
