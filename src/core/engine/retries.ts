/**
 * JARVIS Core — Topes y preguntas del bucle de paso (Fase 5).
 *
 * Sin estado propio (D5): todo se deriva de `calls` y `facts`. No hay contadores de reintento: el único tope del paso es
 * el de llamadas (FLUJO 3). Aquí solo vive la REGLA (comparar con `BUDGET`); el número sale de la tabla única.
 */

import { BUDGET } from "../budget.ts";
import { isExecuted, type TaskContext } from "../ctx/index.ts";

/** Tope de llamadas por paso alcanzado (sin `user_rejected`): no se inicia otra llamada. */
export function callCapReached(ctx: TaskContext, stepId: string): boolean {
  return ctx.callsInStep(stepId) >= BUDGET.maxCallsPerStep;
}

/** Tope de rechazos de la revisión alcanzado en el paso (`args_invalid`, del pre-chequeo o de Decisión 3): el paso falla en vez de reintentar. */
export function reviewRejectionsReached(ctx: TaskContext, stepId: string): boolean {
  const rejected = ctx.find("calls", { stepId }).filter((c) => c.status === "args_invalid");
  return rejected.length >= BUDGET.maxReviewRejectionsPerStep;
}

/** Tope de llamadas bloqueadas por repetición alcanzado en el paso: el paso falla en vez de volver a pedir lo mismo. */
export function repeatsReached(ctx: TaskContext, stepId: string): boolean {
  return ctx.find("calls", { stepId }).filter((c) => c.status === "loop_blocked").length >= BUDGET.maxRepeatsPerStep;
}

/**
 * ¿La llamada bloqueada por repetición repetía una llamada idéntica que la verificación ya aprobó? Entonces lo pedido ya está
 * hecho (el modelo volvió a pedir lo mismo, p. ej. tras reescribir el ítem): el paso se da por cumplido en vez de fallar.
 */
export function repeatsApprovedCall(ctx: TaskContext, callId: string): boolean {
  const calls = ctx.find("calls", {});
  const at = calls.findIndex((c) => c.id === callId);
  if (at < 0) return false;
  const blocked = calls[at];
  for (let i = at - 1; i >= 0; i--) {
    const c = calls[i];
    if (c.tool === blocked.tool && c.sig === blocked.sig && c.sig !== null && isExecuted(c)) return c.verdict === "approved";
  }
  return false;
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