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
 * - Respuesta inválida (`...ValidationError` sin `overflow`): `invalid`. Aquí NO se repite: Qwen ya reintenta una vez por su cuenta
 *   (`BUDGET.invalidResponseRetries`, en `models/qwen.ts`) y Decision es determinista (repetir da lo mismo). Quien llama decide (para
 *   Decision y el verificador: igual que `unavailable`; para los argumentos: `args_invalid`).
 * - Cualquier otra excepción es un defecto del código y se propaga.
 *
 * Si el servicio caído es el propio LLM, el cierre lo recuerda (`env.state.llmDown`): la respuesta final no lo consulta y va
 * directo a `forFallback` (FLUJO 9).
 */

import {
  DecisionServiceUnavailableError,
  DecisionValidationError,
  LLMServiceUnavailableError,
  LLMValidationError,
} from "../types/modelErrors.ts";
import { PAUSE_RETRY_MAX_MS, PAUSE_RETRY_MIN_MS } from "../timeouts.ts";
import { errorMessage, RequestAbortedError } from "../utils.ts";
import type { EngineEnv } from "./env.ts";
import type { TaskRuntime } from "./runtime.ts";

export type ModelFailureKind = "cancelled" | "unavailable" | "overflow" | "invalid";

type ModelResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ModelFailureKind; readonly error: unknown };

export interface ModelPauseContext {
  readonly model: "llm" | "decision";
  readonly runtime: Pick<TaskRuntime, "signal" | "cancelled" | "setPaused">;
  readonly maxPauseMs: number;
}

export function pauseOf(env: EngineEnv, model: "llm" | "decision"): ModelPauseContext {
  return {
    model,
    runtime: env.runtime,
    maxPauseMs: Math.max(0, env.deps.modelUnavailablePauseMaxMs?.() ?? 0),
  };
}

/** Clasifica el error de una consulta a un modelo; `null` si no es de ninguna de las clases conocidas (defecto del código). */
function classifyModelError(error: unknown): ModelFailureKind | null {
  if (error instanceof RequestAbortedError) return "cancelled";
  if (error instanceof DecisionServiceUnavailableError || error instanceof LLMServiceUnavailableError) return "unavailable";
  if (error instanceof DecisionValidationError || error instanceof LLMValidationError) return error.overflow ? "overflow" : "invalid";
  return null;
}

const isRetryableUnavailable = (error: unknown): boolean =>
  (error instanceof LLMServiceUnavailableError || error instanceof DecisionServiceUnavailableError) &&
  error.retryable !== false;

function waitAbortable(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Ejecuta una consulta a un modelo. Una respuesta inválida no se repite aquí (ver la cabecera). Ante un fallo `unavailable`
 * reintentable (red, timeout o HTTP no-OK) pausa la tarea y reintenta con espera creciente (2 s a 30 s) hasta `maxPauseMs` o
 * cancelación. URL sin configurar (`retryable = false`), desborde y cancelación no se pausan ni se repiten.
 */
export async function queryModel<T>(call: () => Promise<T>, pause?: ModelPauseContext): Promise<ModelResult<T>> {
  let pauseStartedAt: number | null = null;
  let delayMs = PAUSE_RETRY_MIN_MS;
  try {
    for (;;) {
      if (pause?.runtime.cancelled) {
        return { ok: false, failure: "cancelled", error: new RequestAbortedError() };
      }
      try {
        return { ok: true, value: await call() };
      } catch (error) {
        const failure = classifyModelError(error);
        if (failure === null) throw error;
        if (
          failure === "unavailable" &&
          isRetryableUnavailable(error) &&
          pause !== undefined &&
          pause.maxPauseMs > 0
        ) {
          const now = Date.now();
          if (pauseStartedAt === null) {
            pauseStartedAt = now;
            pause.runtime.setPaused({ since: pauseStartedAt, model: pause.model });
            console.warn(`[Engine] modelo '${pause.model}' no disponible (${errorMessage(error)}); pausando tarea hasta ${pause.maxPauseMs}ms.`);
          }
          const remaining = pauseStartedAt + pause.maxPauseMs - now;
          if (remaining > 0) {
            const waitMs = Math.min(delayMs, remaining);
            delayMs = Math.min(delayMs * 2, PAUSE_RETRY_MAX_MS);
            const aborted = await waitAbortable(waitMs, pause.runtime.signal);
            if (aborted) {
              return { ok: false, failure: "cancelled", error: new RequestAbortedError() };
            }
            continue;
          }
          console.warn(`[Engine] pausa agotada (${pause.maxPauseMs}ms) esperando al modelo '${pause.model}'.`);
        }
        return { ok: false, failure, error };
      }
    }
  } finally {
    if (pauseStartedAt !== null && pause !== undefined) {
      pause.runtime.setPaused(null);
    }
  }
}

/** Qué cierra la tarea (o la cancela) tras un fallo que no es recuperable dentro del paso. */
type FailureClosure = { readonly kind: "cancelled" } | { readonly kind: "close"; readonly stopReason: "unrecoverable" };

/**
 * Traduce un fallo a su cierre y, solo cuando el servicio no está disponible (o la respuesta sigue inválida tras repetir),
 * registra `error service_unavailable` en el paso. El desborde no registra nada: la causa queda en la consola y en la
 * captura de la traza. Sin paso (`stepId = null`: fallo anterior a que existan pasos, o antes de ejecutar el plan) tampoco
 * se registra `error`. No cierra la tarea (`finish` es de la Fase 6).
 */
export function closeOnFailure(env: Pick<EngineEnv, "ctx" | "state">, stepId: string | null, failure: ModelFailureKind, detail: unknown): FailureClosure {
  if (failure === "cancelled") return { kind: "cancelled" };
  const { ctx } = env;
  console.error(`[Engine] la tarea no puede continuar (${failure}): ${errorMessage(detail)}`);
  if (detail instanceof LLMServiceUnavailableError) env.state.llmDown = true;
  if (failure !== "overflow" && stepId !== null && !ctx.isClosed()) {
    ctx.apply({ op: "add", target: "errors", value: { stepId, kind: "service_unavailable" } });
  }
  return { kind: "close", stopReason: "unrecoverable" };
}