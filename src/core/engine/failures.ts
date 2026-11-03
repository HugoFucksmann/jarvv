/**
 * JARVIS Core — Fallos de los modelos y de la infraestructura (Fase 5, D4, D15, D29).
 *
 * Un solo lugar para decidir qué hace el ejecutor cuando una consulta a un modelo falla:
 *
 * - Cancelación del usuario (`RequestAbortedError`): `cancelled`; se propaga sin registrar nada.
 * - Servicio caído (`...ServiceUnavailableError`): `unavailable`. Se registra `error service_unavailable` y la tarea cierra
 *   con `unrecoverable`.
 * - Desborde del contexto del modelo (`overflow = true`): `overflow`. Se cierra con `unrecoverable` SIN `error` (el servicio no
 *   cayó; repetir daría lo mismo) y sin repetir.
 * - Respuesta inválida (`...ValidationError` sin `overflow`): `invalid`. Se repite la consulta una vez
 *   (`BUDGET.invalidResponseRetries`) cuando el modelo no reintenta por sí mismo; si persiste, quien llama decide (para
 *   Decision y el verificador: igual que `unavailable`; para los argumentos: `args_invalid`).
 * - Cualquier otra excepción es un defecto del código y se propaga.
 *
 * Si el servicio caído es el propio LLM, el cierre lo recuerda (`isLlmDown`): la respuesta final no lo consulta y va
 * directo a `forFallback` (FLUJO 9).
 */

import { BUDGET } from "../budget.ts";
import type { TaskContext } from "../ctx/index.ts";
import {
  DecisionServiceUnavailableError,
  DecisionValidationError,
  LLMServiceUnavailableError,
  LLMValidationError,
  RequestAbortedError,
} from "../llmTransport.ts";
import { errorMessage } from "../utils.ts";

export type ModelFailureKind = "cancelled" | "unavailable" | "overflow" | "invalid";

export type ModelResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ModelFailureKind; readonly error: unknown };

/** Clasifica el error de una consulta a un modelo; `null` si no es de ninguna de las clases conocidas (defecto del código). */
export function classifyModelError(error: unknown): ModelFailureKind | null {
  if (error instanceof RequestAbortedError) return "cancelled";
  if (error instanceof DecisionServiceUnavailableError || error instanceof LLMServiceUnavailableError) return "unavailable";
  if (error instanceof DecisionValidationError || error instanceof LLMValidationError) return error.overflow ? "overflow" : "invalid";
  return null;
}

/**
 * Ejecuta una consulta a un modelo. Ante una respuesta inválida la repite hasta `repeatOnInvalid` veces (0 = no repite: el
 * modelo ya reintenta internamente, como Qwen). Nunca repite un desborde, un servicio caído ni una cancelación.
 */
export async function queryModel<T>(call: () => Promise<T>, repeatOnInvalid: number = BUDGET.invalidResponseRetries): Promise<ModelResult<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return { ok: true, value: await call() };
    } catch (error) {
      const failure = classifyModelError(error);
      if (failure === null) throw error;
      if (failure === "invalid" && attempt < repeatOnInvalid) {
        console.warn(`[Engine] respuesta inválida (${errorMessage(error)}); se repite la consulta (${attempt + 1}/${repeatOnInvalid}).`);
        continue;
      }
      return { ok: false, failure, error };
    }
  }
}

/** Tareas cuyo LLM está caído. Es del motor, no del contexto (principio 5): la clave es el contexto vivo de la tarea. */
const llmDown = new WeakSet<TaskContext>();

/** ¿Un fallo anterior de esta tarea fue el LLM caído? */
export function isLlmDown(ctx: TaskContext): boolean {
  return llmDown.has(ctx);
}

/** Qué cierra la tarea (o la cancela) tras un fallo que no es recuperable dentro del paso. */
export type FailureClosure = { readonly kind: "cancelled" } | { readonly kind: "close"; readonly stopReason: "unrecoverable" };

/**
 * Traduce un fallo a su cierre y, solo cuando el servicio no está disponible (o la respuesta sigue inválida tras repetir),
 * registra `error service_unavailable` en el paso. El desborde no registra nada: la causa queda en la consola y en la
 * captura de la traza. Sin paso (`stepId = null`: fallo anterior a que existan pasos, o antes de ejecutar el plan) tampoco
 * se registra `error`. No cierra la tarea (`finish` es de la Fase 6).
 */
export function closeOnFailure(ctx: TaskContext, stepId: string | null, failure: ModelFailureKind, detail: unknown): FailureClosure {
  if (failure === "cancelled") return { kind: "cancelled" };
  console.error(`[Engine] la tarea no puede continuar (${failure}): ${errorMessage(detail)}`);
  if (detail instanceof LLMServiceUnavailableError) llmDown.add(ctx);
  if (failure !== "overflow" && stepId !== null && !ctx.isClosed()) {
    ctx.apply({ op: "add", target: "errors", value: { stepId, kind: "service_unavailable" } });
  }
  return { kind: "close", stopReason: "unrecoverable" };
}