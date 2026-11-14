/**
 * JARVIS Core — D0: clasificar la solicitud al empezar una tarea reactiva (charla, una acción o varias).
 *
 * Una sola consulta de decisión (unos 50 ms) antes de `pending`. Es una optimización, nunca una condición: sin `firstQuery` en Decision, con la
 * consulta fallida o con la tarea ya empezada, devuelve `null` y la tarea sigue por el flujo de siempre (el fallo real lo vuelve a ver, y lo cierra,
 * la primera consulta que sí es necesaria). Qué hace el motor con cada resultado: `runReactive` (`runTask.ts`).
 */

import type { FirstQueryKind } from "./firstQuery.ts";
import type { EngineEnv } from "./env.ts";
import { queryModel } from "./failures.ts";
import { errorMessage } from "../utils.ts";
import type { PreviousTask } from "../contracts.ts";
import { CONTINUATION_APPROVE } from "./thread.ts";

export async function classifyRequest(env: EngineEnv): Promise<FirstQueryKind | null> {
  const { ctx, runtime, decision } = env;
  if (decision.firstQuery === undefined) return null;
  // Solo al empezar: con pasos o llamadas la solicitud ya tomó un camino.
  if (ctx.find("steps", {}).length > 0 || ctx.find("calls", {}).length > 0) return null;

  const query = await queryModel(() => decision.firstQuery!({ request: ctx.task.request }, runtime.signal), 0);
  if (!query.ok) {
    if (query.failure !== "cancelled") console.warn(`[Engine] D0 no disponible (${query.failure}: ${errorMessage(query.error)}); la tarea sigue por el flujo de siempre.`);
    return null;
  }
  return query.value.kind;
}

/**
 * Hilo: la tarea anterior si el pedido nuevo la continúa (probabilidad de `follow` ≥ `CONTINUATION_APPROVE`), o `null`. Sin tarea anterior vigente, sin `continuation` en
 * Decision o con la consulta fallida, `null`: la tarea sigue como siempre (no detectar equivale al comportamiento de antes).
 */
export async function detectContinuation(env: EngineEnv): Promise<PreviousTask | null> {
  const { ctx, runtime, decision, deps } = env;
  const previous = deps.previousTask ?? null;
  if (previous === null || decision.continuation === undefined) return null;
  if (ctx.find("steps", {}).length > 0 || ctx.find("calls", {}).length > 0) return null;

  const query = await queryModel(() => decision.continuation!({ previous, request: ctx.task.request }, runtime.signal), 0);
  if (!query.ok) {
    if (query.failure !== "cancelled") console.warn(`[Engine] continuación no disponible (${query.failure}: ${errorMessage(query.error)}); sin hilo.`);
    return null;
  }
  return query.value.follows >= CONTINUATION_APPROVE ? previous : null;
}
