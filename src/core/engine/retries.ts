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

/** Valor de un hecho, o `null` si no existe o está retirado. */
export function factValue(ctx: TaskContext, key: string): string | null {
  const element = ctx.get(`facts.${key}`);
  return element !== undefined && "value" in element ? element.value : null;
}

/**
 * ¿Se puede ofrecer `ask_user` en este paso? Sin tope propio de preguntas: sí mientras no haya una respuesta del paso
 * posterior a su última llamada (al empezar el paso, siempre). Si la revisión vuelve a dar `info_missing`, Decisión 1
 * puede volver a preguntar; lo cortan el tope de llamadas y el anti-loop (FLUJO 6).
 */
export function canAskUser(ctx: TaskContext, stepId: string): boolean {
  return ctx.canAsk(stepId);
}