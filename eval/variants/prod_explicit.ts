import type { Variant } from "../core/variants/types.ts";

/**
 * Variante identidad que pasa por el camino de prompts enteros con los prompts de producción (`prompts` vacío pero
 * definido). Sirve para comprobar que ese camino arma los mismos requests que la carga normal: `prod` y `prod_explicit`
 * deben dar el mismo `requestHash` caso por caso en un dataset por escenario.
 */
const prod_explicit: Variant = {
  name: "prod_explicit",
  prompts: { PROMPTS: {}, DECISION_PROMPTS: {} },
};

export default prod_explicit;
