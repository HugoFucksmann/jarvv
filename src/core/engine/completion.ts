/**
 * JARVIS Core — Cierre del reactivo con Decisión 5 (`checkCompletion`).
 *
 * Cuando el último ítem de la lista termina bien (la lista queda vacía y no se abandonó nada), antes de confirmar con el LLM generativo que no falta nada
 * (~900 ms) se le hace una sola pregunta al modelo de decisión (~50 ms): con la solicitud y todo lo hecho a la vista, ¿la solicitud está cumplida?
 * Si responde que sí con probabilidad de al menos `COMPLETION_APPROVE`, la tarea cierra `completed` sin llamar al LLM. En cualquier otro caso (no, duda, respuesta
 * inválida o desborde, nada hecho todavía) se cae a la confirmación del LLM como antes: un falso "no" solo cuesta esa llamada, mientras que un falso "sí" cierra la tarea
 * incompleta en silencio, por eso el umbral es más estricto que `NOUL_APPROVE`.
 *
 * Solo en reactivo y con `ctx.canFinish() === "completed"` (hay una llamada aprobada y nada quedó abandonado por el usuario): es la misma regla con la que
 * `generatePending` acepta una lista vacía. Si el modelo de decisión no está disponible, rige la pausa de `queryModel` (`MEMORIA_CONTEXTO_DISENO.md` §6.1) y, agotada,
 * la tarea cierra `unrecoverable`.
 */

import { completionInput } from "./adapters.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, pauseOf, queryModel } from "./failures.ts";

/** Probabilidad mínima de `request_complete` para cerrar sin consultar al LLM (eval/exp/close_check.ts: 31/36 a 0,75; a 0,9 los falsos "no" se multiplican). */
export const COMPLETION_APPROVE = 0.75;

/**
 * Decisión 5 está segura de que falta algo con una probabilidad de `request_complete` por debajo de esto. Con esa seguridad, una lista de pendientes que el código vació por
 * parecerse a lo ya cumplido (`reconcileList`) no cierra la tarea: lo que pendientes propone se ejecuta (ver `runReactive`).
 */
export const COMPLETION_INCOMPLETE_BELOW = 0.25;

/** Extensiones que cuentan como «un archivo nombrado» en la guarda de cobertura (una lista cerrada evita tomar `github.com` o `v1.2` por archivos). */
const FILE_EXT = "txt|md|json|csv|ps1|py|js|ts|pdf|docx?|xlsx?|pptx?|png|jpe?g|zip|html?|css|log|xml|ya?ml|ini|bat|cmd|exe|mp3|mp4";
const FILE_NAME = new RegExp(`[\\w\\-]+\\.(?:${FILE_EXT})(?![\\w])`, "gi");

/**
 * Archivos que el pedido nombra y que NINGUNA llamada de la tarea menciona (en sus argumentos ni en su resumen), sin distinguir mayúsculas. Un archivo que el pedido
 * nombra y que nadie tocó es una señal determinista de que falta algo. Solo se mira el nombre (la carpeta no importa).
 */
export function uncoveredArtifacts(request: string, calls: readonly { readonly args: unknown; readonly summary: string | null }[]): string[] {
  const named = [...new Set((request.match(FILE_NAME) ?? []).map((n) => n.toLowerCase()))];
  if (named.length === 0) return [];
  const haystack = calls.map((c) => `${JSON.stringify(c.args ?? null)} ${c.summary ?? ""}`).join("\n").toLowerCase().replace(/\\\\|\\/g, "/");
  return named.filter((n) => !haystack.includes(n));
}

export type CompletionOutcome =
  | { readonly kind: "complete" }
  | { readonly kind: "incomplete" }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

/** ¿La solicitud está cumplida con lo hecho? `incomplete` ante la duda; si Decision falla tras la pausa (§6.1), cierra `unrecoverable`. */
export async function confirmCompletion(env: EngineEnv): Promise<CompletionOutcome> {
  const { ctx, runtime } = env;
  env.state.lastCompletion = null;
  if (ctx.task.mode !== "reactive" || ctx.canFinish() !== "completed") return { kind: "incomplete" };
  // Guarda de cobertura (config `completionCoverageGuard`, experimental): un archivo nombrado en el pedido que ninguna llamada menciona impide el cierre rápido
  // (y ahorra la consulta); la tarea sigue con la confirmación de siempre. Solo puede volver el cierre más estricto.
  if (env.deps.completionCoverageGuard?.() === true) {
    const missing = uncoveredArtifacts(ctx.task.request, ctx.find("calls", {}));
    if (missing.length > 0) {
      console.warn(`[Engine] cierre por Decisión 5 omitido: el pedido nombra ${missing.join(", ")} y ninguna llamada lo menciona.`);
      return { kind: "incomplete" };
    }
  }

  const query = await queryModel(() => env.decision.checkCompletion(completionInput(ctx), runtime.signal), 0, pauseOf(env, "decision"));
  if (!query.ok) {
    // Una respuesta inválida o un desborde de esta consulta no es un modelo caído: es un atajo que no se pudo tomar, y la tarea sigue con la confirmación del LLM.
    if (query.failure === "invalid" || query.failure === "overflow") {
      console.warn(`[Engine] cierre por Decisión 5 no disponible (${query.failure}); se confirma con el LLM.`);
      return { kind: "incomplete" };
    }
    const closure = closeOnFailure(env, null, query.failure, query.error);
    return closure.kind === "cancelled" ? { kind: "cancelled" } : { kind: "close", stopReason: closure.stopReason };
  }
  if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };
  env.state.lastCompletion = query.value.requestComplete;
  return { kind: query.value.requestComplete >= COMPLETION_APPROVE ? "complete" : "incomplete" };
}
