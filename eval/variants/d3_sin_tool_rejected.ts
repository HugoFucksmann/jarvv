import type { Variant } from "../core/variants/types.ts";

/**
 * Decisión 3 (`args_review`, d3:2b). Quita la opción `tool_rejected`; las demás claves y su orden son los de producción.
 *
 * Evidencia (matriz de `prod`, `scenarios_args_review`): `tool_rejected` se predijo 40 veces y solo 10 eran correctas
 * (precisión 25 %); 30 falsos positivos salieron de casos esperados `args_invalid` (20) y `approved` (10). D3 no recibe las
 * otras herramientas de la ruta, así que "otra herramienta debería usarse" no se puede juzgar: solo se ve la candidata.
 *
 * Hipótesis: sin esa opción, esas 30 corridas caen en `approved` o `args_invalid` y el total sube. Costo conocido de
 * antemano: los casos esperados `tool_rejected` (3 casos, 15 corridas) fallan por construcción; mirarlos aparte y
 * comparar por caso, no por pass rate. Si funciona, la decisión para `src` es del dueño del flujo: quitar la opción cuando
 * la ruta tiene una sola herramienta, o pasarle a D3 la lista de las otras herramientas de la ruta.
 */
const d3_sin_tool_rejected: Variant = {
  name: "d3_sin_tool_rejected",
  decision: {
    args_review: {
      questions: { review: { criteria: { remove: ["tool_rejected"] } } },
    },
  },
};

export default d3_sin_tool_rejected;
