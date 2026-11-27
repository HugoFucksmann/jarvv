/**
 * JARVIS Core — Cierre del reactivo con Decisión 5 (`checkCompletion`).
 *
 * Cuando el último ítem de la lista termina bien (la lista queda vacía), antes de confirmar con el LLM generativo que no falta nada
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
import { findRequirementGaps } from "./requirements.ts";

/** Probabilidad mínima de `request_complete` para cerrar sin consultar al LLM (eval/exp/close_check.ts: 31/36 a 0,75; a 0,9 los falsos "no" se multiplican). */
export const COMPLETION_APPROVE = 0.75;

/**
 * Decisión 5 está segura de que falta algo con una probabilidad de `request_complete` por debajo de esto. Con esa seguridad, una lista de pendientes que el código vació por
 * parecerse a lo ya cumplido (`reconcileList`) no cierra la tarea: lo que pendientes propone se ejecuta (ver `runReactive`).
 */
export const COMPLETION_INCOMPLETE_BELOW = 0.25;

/**
 * Cobertura de la primera lista de pendientes (`covers`) desde la que, con todos sus ítems cumplidos y sin ningún paso fallido, la tarea cierra `completed` sin consultar a Decisión 5.
 * Cada ítem ya pasó la verificación de su paso (D4) y la lista cubre el pedido: lo que D5 aportaba (con la lista vacía, juzgar todo lo hecho junto) es lo que el modelo chico hace
 * peor (daba 0,28 a 0,46 con el pedido cumplido). El corte sale de `eval/exp/list_coverage.ts` sobre 417 listas con verdad conocida: con 0,99 acepta 7 % de las listas a las que les
 * falta una parte (D5 solo deja pasar algo parecido) y manda a D5 el 28 % de las completas; con 0,75 a 0,80 aceptaría 60 % de las incompletas, por eso no sirve ese valor.
 */
export const LIST_COVERAGE_CLOSE = 0.99;

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

type CompletionOutcome =
  /** `by`: `list_coverage` si cerró sin consultar a Decisión 5 (lista cubierta y cumplida); sin él, cerró Decisión 5. */
  | { readonly kind: "complete"; readonly by?: "list_coverage" }
  /** `gaps`: los pasos que cierran lo que el libro de requisitos halló sin cubrir (`engine/requirements.ts`); sin ellos, rige la confirmación de siempre. */
  | { readonly kind: "incomplete"; readonly gaps?: readonly string[] }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

/** Los requisitos de la solicitud (la primera lista de pendientes) y si la lista todavía puede reabrirse; con ellos el cierre consulta el libro de requisitos. */
interface RequirementsLedger {
  readonly requirements: readonly string[];
  readonly canReopen: boolean;
}

/**
 * ¿La solicitud está cumplida con lo hecho? `incomplete` ante la duda; si Decision falla tras la pausa (§6.1), cierra `unrecoverable`. Con el libro de requisitos
 * (`ledger`), aun con Decisión 5 segura de que está cumplida, un requisito sin datos o sin volcar al entregable impide cerrar y devuelve el paso que lo cubre.
 */
export async function confirmCompletion(env: EngineEnv, ledger: RequirementsLedger | null = null): Promise<CompletionOutcome> {
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

  // Lista cubierta y cumplida: el libro de requisitos sigue mandando (un requisito de información sin datos reabre la lista); sin huecos, cierra sin Decisión 5.
  const listCoverage = env.state.listCoverage;
  if (env.deps.closeByListCoverage?.() !== false && listCoverage !== null && listCoverage >= LIST_COVERAGE_CLOSE && ctx.escalations() === 0) {
    if (ledger !== null && ledger.canReopen) {
      const gaps = await findRequirementGaps(env, ledger.requirements);
      if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };
      if (gaps.length > 0) return { kind: "incomplete", gaps };
    }
    return { kind: "complete", by: "list_coverage" };
  }

  const query = await queryModel(() => env.decision.checkCompletion(completionInput(ctx), runtime.signal), pauseOf(env, "decision"));
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
  if (ledger !== null && ledger.canReopen) {
    const gaps = await findRequirementGaps(env, ledger.requirements);
    if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };
    if (gaps.length > 0) return { kind: "incomplete", gaps };
  }
  return { kind: query.value.requestComplete >= COMPLETION_APPROVE ? "complete" : "incomplete" };
}
