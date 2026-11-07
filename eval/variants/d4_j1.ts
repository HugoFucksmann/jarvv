import { CUMPLE_WITH_CRITERIA, FOUR_WAY, OK_WITH_CRITERIA, j1, withQuestions } from "../core/d4_checks.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * Decisión 4 (`result_verification`). J1 de las pruebas viejas: clasificación en cuatro vías más `cumple` con criteria en una sola request; veto AND (`ok` = no `failed`, `cumple` = mínimo entre `matches` y la binaria).
 * Se mide contra `prod` en `old_verificacion` y los datasets de verificación por escenario: falsos aprobados (malos que pasan)
 * y falsos rechazados (buenos que no pasan), no solo el pass rate.
 */
const d4_j1: Variant = {
  name: "d4_j1",
  prompts: { DECISION_PROMPTS: { buildResultVerification: (data) => withQuestions(data, { effect: FOUR_WAY, cumple: CUMPLE_WITH_CRITERIA }) } },
  decision: { result_verification: { combineVerification: j1 } },
};

export default d4_j1;
