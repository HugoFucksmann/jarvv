/**
 * JARVIS Core — Topes y preguntas del bucle de paso (Fase 5).
 *
 * Sin estado propio (D5): todo se deriva de `calls` y `facts`. No hay contadores de reintento: el único tope del paso es
 * el de llamadas (FLUJO 3). Aquí solo vive la REGLA (comparar con `BUDGET`); el número sale de la tabla única.
 */

import { BUDGET } from "../budget.ts";
import type { TaskContext } from "../ctx/index.ts";

/** Tope de llamadas por paso alcanzado (sin `user_rejected`): no se inicia otra llamada. */
export function callCapReached(ctx: TaskContext, stepId: string): boolean {
  return ctx.callsInStep(stepId) >= BUDGET.maxCallsPerStep;
}

/** Tope de rechazos de la revisión alcanzado en el paso (`tool_rejected` o `args_invalid`): el paso falla en vez de reintentar. */
export function reviewRejectionsReached(ctx: TaskContext, stepId: string): boolean {
  const rejected = ctx.find("calls", { stepId }).filter((c) => c.status === "tool_rejected" || c.status === "args_invalid");
  return rejected.length >= BUDGET.maxReviewRejectionsPerStep;
}

/** Valor de un hecho, o `null` si no existe o está retirado. */
export function factValue(ctx: TaskContext, key: string): string | null {
  const element = ctx.get(`facts.${key}`);
  return element !== undefined && "value" in element ? element.value : null;
}

/** ¿Se puede preguntar al usuario en este paso? Una pregunta por paso (`BUDGET.maxQuestionsPerStep`). */
export function canAskUser(ctx: TaskContext, stepId: string): boolean {
  return ctx.questionsAsked(stepId) < BUDGET.maxQuestionsPerStep;
}