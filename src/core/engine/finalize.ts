/**
 * JARVIS Core — Cierre de la tarea y respuesta final (Fase 6; PLAN_FLUJO 9).
 *
 * `finalize` escribe el estado terminal una sola vez (`finish`) y, en un `apply` posterior, el `result`. El estado sale de
 * la tabla de 5.3 (`terminalStateFor`): sin motivo, `completed`; con motivo, el que le corresponde según los efectos y las
 * llamadas aprobadas.
 *
 * Respuesta final (`result`):
 * - `cancelled`: siempre `forFallback` (texto fijo, sin modelo).
 * - LLM caído (un fallo anterior ya lo marcó): directo a `forFallback`, sin consultarlo.
 * - En los demás cierres, LLM 3 con `forFinal`. Si `forFinal` no entra (efectos que exceden la reserva), o LLM 3 falla por
 *   cualquier causa (caído, salida inválida, cancelación), `forFallback` con `origin = fallback`.
 *
 * El `finish` va antes de la respuesta: la vista final lee el estado y el motivo ya escritos.
 */

import type { ResultEntry, StopReason } from "../ctx/index.ts";
import { terminalStateFor } from "../ctx/index.ts";
import { ContextOverflowError, renderFallback, renderFinal } from "../render/index.ts";
import { finalRenderOptions, finalViewOptions, windowOptions } from "./adapters.ts";
import type { EngineEnv } from "./env.ts";
import { isLlmDown, queryModel } from "./failures.ts";

/** Cómo cierra la tarea: `null` = `completed`; si no, el motivo de detención. */
export interface Closing {
  readonly stopReason: StopReason | null;
}

export async function finalize(env: EngineEnv, closing: Closing): Promise<void> {
  const { ctx } = env;
  if (ctx.isClosed()) return;

  const state = closing.stopReason === null ? "completed" : terminalStateFor(closing.stopReason, ctx.find("calls", {}));
  ctx.apply({ op: "finish", target: "task", value: { state, stopReason: closing.stopReason } });

  ctx.apply({ op: "set", target: "result", value: await answer(env) });
}

async function answer(env: EngineEnv): Promise<ResultEntry> {
  const { ctx, runtime } = env;
  const fallback = (): ResultEntry => ({ text: renderFallback(ctx.view.forFallback(windowOptions())).text, origin: "fallback" });

  if (ctx.task.state === "cancelled" || isLlmDown(ctx)) return fallback();

  let view: string;
  try {
    view = renderFinal(ctx.view.forFinal(finalViewOptions()), finalRenderOptions()).text;
  } catch (error) {
    if (!(error instanceof ContextOverflowError)) throw error;
    console.error(`[Engine] ${error.message}; respuesta de respaldo.`);
    return fallback();
  }

  // Qwen ya repite una vez una salida inválida: aquí no se repite.
  const query = await queryModel(() => env.llm.generateFinalFromView({ view }, runtime.signal), 0);
  if (!query.ok) {
    console.error(`[Engine] LLM 3 falló (${query.failure}); respuesta de respaldo.`);
    return fallback();
  }
  return { text: query.value.response, origin: "model" };
}
