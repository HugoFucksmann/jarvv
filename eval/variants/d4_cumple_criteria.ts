import { CUMPLE_WITH_CRITERIA, FOUR_WAY, OK_WITH_CRITERIA, j1, withQuestions } from "../core/d4_checks.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Decisión 4 (`result_verification`). Solo `cumple` con criteria true/false (el patrón N2 de las pruebas viejas); `ok` como producción.
 * Se mide contra `prod` en `old_verificacion` y los datasets de verificación por escenario: falsos aprobados (malos que pasan)
 * y falsos rechazados (buenos que no pasan), no solo el pass rate.
 */
const d4_cumple_criteria: Variant = {
  name: "d4_cumple_criteria",
  prompts: { DECISION_PROMPTS: { buildResultVerification: (data) => withQuestions(data, { ok: { type: "noul", instructions: "Is the result usable: either it contains data, or (for an action that changes something) it confirms that the action succeeded? It is not usable if it is empty or an error message." }, cumple: CUMPLE_WITH_CRITERIA }) } },
};

export default d4_cumple_criteria;
