/**
 * JARVIS Core — Topes y preguntas del bucle de paso (Fase 5).
 *
 * Sin estado propio (D5): todo se deriva de `calls` y `facts`. Los topes (qué se cuenta y contra qué número) están en `limits.ts`;
 * aquí quedan las decisiones que dependen de lo ya ocurrido en el paso (si se puede preguntar, si lo repetido ya estaba aprobado).
 */

import { BUDGET } from "../budget.ts";
import { isExecuted, type TaskContext } from "../ctx/index.ts";

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