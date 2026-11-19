/**
 * JARVIS Core — D0 y detección de continuación al empezar una tarea reactiva.
 *
 * Consultan al modelo de decisión con la política común de pausa y reintento (`queryModel` + `pauseOf`, §6.1). Si la
 * consulta no está configurada (`firstQuery`/`continuation` ausente o sin tarea anterior vigente) siguen el flujo normal;
 * si el modelo de decisión no está disponible (pausa agotada o URL sin configurar), la tarea cierra `unrecoverable` sin degradación silenciosa
 * (§6.1, §7.4). Una respuesta inválida o un desborde de la consulta sí siguen el flujo normal, como antes.
 */

import type { FirstQueryKind } from "./firstQuery.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, pauseOf, queryModel } from "./failures.ts";
import type { ModelFailureKind } from "./failures.ts";
import type { PreviousTask } from "../contracts.ts";
import { errorMessage } from "../utils.ts";
import { CONTINUATION_APPROVE } from "./thread.ts";

/** Una respuesta inválida o un desborde de estas consultas (atajos) no es un modelo caído: la tarea sigue sin su aporte. Un modelo no disponible (agotada la pausa) o una cancelación sí cierran. */
const degradesToDefault = (failure: ModelFailureKind): boolean => failure === "invalid" || failure === "overflow";

export type ClassifyOutcome =
  | { readonly kind: "classified"; readonly first: FirstQueryKind | null }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

export type ContinuationOutcome =
  | { readonly kind: "resolved"; readonly previous: PreviousTask | null }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

export async function classifyRequest(env: EngineEnv): Promise<ClassifyOutcome> {
  const { ctx, runtime, decision } = env;
  if (decision.firstQuery === undefined) return { kind: "classified", first: null };
  // Solo al empezar: con pasos o llamadas la solicitud ya tomó un camino.
  if (ctx.find("steps", {}).length > 0 || ctx.find("calls", {}).length > 0) return { kind: "classified", first: null };

  const query = await queryModel(() => decision.firstQuery!({ request: ctx.task.request }, runtime.signal), pauseOf(env, "decision"));
  if (!query.ok) {
    if (degradesToDefault(query.failure)) {
      console.warn(`[Engine] D0 sin respuesta utilizable (${query.failure}: ${errorMessage(query.error)}); la tarea sigue por el flujo de siempre.`);
      return { kind: "classified", first: null };
    }
    const closure = closeOnFailure(env, null, query.failure, query.error);
    return closure.kind === "cancelled" ? { kind: "cancelled" } : { kind: "close", stopReason: closure.stopReason };
  }
  if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };
  return { kind: "classified", first: query.value.kind };
}

/**
 * Hilo: la tarea anterior si el pedido nuevo la continúa (probabilidad de `follow` ≥ `CONTINUATION_APPROVE`), o `null`.
 * Sin tarea anterior vigente o sin `continuation` en Decision, `null`; si la consulta falla tras la pausa de §6.1, cierra `unrecoverable`.
 */
export async function detectContinuation(env: EngineEnv): Promise<ContinuationOutcome> {
  const { ctx, runtime, decision, deps } = env;
  const previous = deps.previousTask ?? null;
  if (previous === null || decision.continuation === undefined) return { kind: "resolved", previous: null };
  if (ctx.find("steps", {}).length > 0 || ctx.find("calls", {}).length > 0) return { kind: "resolved", previous: null };

  const query = await queryModel(() => decision.continuation!({ previous, request: ctx.task.request }, runtime.signal), pauseOf(env, "decision"));
  if (!query.ok) {
    if (degradesToDefault(query.failure)) {
      console.warn(`[Engine] continuación sin respuesta utilizable (${query.failure}: ${errorMessage(query.error)}); sin hilo.`);
      return { kind: "resolved", previous: null };
    }
    const closure = closeOnFailure(env, null, query.failure, query.error);
    return closure.kind === "cancelled" ? { kind: "cancelled" } : { kind: "close", stopReason: closure.stopReason };
  }
  if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };
  return { kind: "resolved", previous: query.value.follows >= CONTINUATION_APPROVE ? previous : null };
}
