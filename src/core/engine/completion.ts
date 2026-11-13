/**
 * JARVIS Core — Cierre del reactivo con Decisión 5 (`checkCompletion`).
 *
 * Cuando el último ítem de la lista termina bien (la lista queda vacía y no se abandonó nada), antes de confirmar con el LLM generativo que no falta nada
 * (~900 ms) se le hace una sola pregunta al modelo de decisión (~50 ms): con la solicitud y todo lo hecho a la vista, ¿la solicitud está cumplida?
 * Si responde que sí con probabilidad de al menos `COMPLETION_APPROVE`, la tarea cierra `completed` sin llamar al LLM. En cualquier otro caso (no, duda, fallo del
 * servicio, nada hecho todavía) se cae a la confirmación del LLM como antes: un falso "no" solo cuesta esa llamada, mientras que un falso "sí" cierra la tarea
 * incompleta en silencio, por eso el umbral es más estricto que `NOUL_APPROVE`.
 *
 * Solo en reactivo y con `ctx.canFinish() === "completed"` (hay una llamada aprobada y nada quedó abandonado por el usuario): es la misma regla con la que
 * `generatePending` acepta una lista vacía. Un fallo del servicio de decisión no cierra la tarea aquí: lo vuelve a ver (y lo cierra) la consulta del LLM.
 */

import { completionInput } from "./adapters.ts";
import type { EngineEnv } from "./env.ts";
import { queryModel } from "./failures.ts";

/** Probabilidad mínima de `request_complete` para cerrar sin consultar al LLM (eval/exp/close_check.ts: 31/36 a 0,75; a 0,9 los falsos "no" se multiplican). */
export const COMPLETION_APPROVE = 0.75;

/** ¿La solicitud está cumplida con lo hecho? `false` ante la duda o un fallo: la tarea sigue con la confirmación del LLM. */
export async function confirmCompletion(env: EngineEnv): Promise<boolean> {
  const { ctx, runtime } = env;
  if (ctx.task.mode !== "reactive" || ctx.canFinish() !== "completed") return false;

  const query = await queryModel(() => env.decision.checkCompletion(completionInput(ctx), runtime.signal));
  if (!query.ok) {
    console.warn(`[Engine] cierre por Decisión 5 no disponible (${query.failure}); se confirma con el LLM.`);
    return false;
  }
  if (runtime.cancelled || ctx.isClosed()) return false;
  return query.value.requestComplete >= COMPLETION_APPROVE;
}
