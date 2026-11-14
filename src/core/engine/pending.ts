/**
 * JARVIS Core — Lista de pendientes del reactivo (Fase 6).
 *
 * Una consulta aparte al LLM (sin thinking) devuelve la lista completa de lo que falta para cumplir la solicitud, a partir de la
 * solicitud, la lista anterior y lo hecho (`forPending`). `runReactive` la hace al empezar, tras un paso fallido (reescribir el
 * ítem) y al vaciarse la lista (confirmar que no falta nada); entre tanto la lista la mantiene el código (`pendingList.ts`). El primer pendiente es la
 * instrucción del paso; la lista vacía significa que no queda nada por hacer. La lista vive solo en `runReactive`: en el
 * contexto entra únicamente la instrucción del paso.
 *
 * Una lista vacía no siempre se acepta (`canFinish()` decide el cierre):
 * - Sin llamadas (primera vuelta) o solo con fallos: se consulta una vez más. Si vuelve vacía: sin llamadas se acepta
 *   (solicitud que no necesita herramientas, cierra `completed`); solo con fallos no se acepta y la instrucción es la
 *   solicitud entera.
 * - Con una llamada aprobada: se acepta y cierra `completed`. Con una `user_rejected` y ninguna aprobada: se acepta y cierra
 *   `no_alternatives`.
 *
 * Qwen ya repite una vez una salida inválida; si persiste, o el servicio cae, la tarea cierra `unrecoverable`. No hay paso
 * todavía: el fallo no registra `error`.
 */

import type { PreviousTask } from "../contracts.ts";
import { pendingInput } from "./adapters.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, queryModel } from "./failures.ts";

export type PendingOutcome =
  /** `list` no vacía: `list[0]` es la instrucción del paso. */
  | { readonly kind: "next"; readonly list: readonly string[] }
  /** Nada por hacer: la tarea cierra con `closure`. */
  | { readonly kind: "done"; readonly closure: "completed" | "no_alternatives" }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

type Listed = { readonly kind: "listed"; readonly list: readonly string[] } | Extract<PendingOutcome, { kind: "close" | "cancelled" }>;

async function listPending(env: EngineEnv, input: ReturnType<typeof pendingInput>): Promise<Listed> {
  const { ctx, runtime } = env;
  const query = await queryModel(() => env.llm.generatePendingFromView(input, runtime.signal), 0);
  if (!query.ok) {
    const closure = closeOnFailure(ctx, null, query.failure, query.error);
    return closure.kind === "cancelled" ? { kind: "cancelled" } : { kind: "close", stopReason: closure.stopReason };
  }
  if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };
  return { kind: "listed", list: query.value.pending };
}

/** La entrada de `pending` con la tarea anterior, si el pedido la continúa. */
const withThread = (input: ReturnType<typeof pendingInput>, thread: PreviousTask | null): ReturnType<typeof pendingInput> => (thread === null ? input : { ...input, thread });

export async function generatePending(env: EngineEnv, previous: readonly string[]): Promise<PendingOutcome> {
  const { ctx } = env;
  const input = withThread(pendingInput(ctx, previous), env.follow.thread);

  let listed = await listPending(env, input);
  if (listed.kind !== "listed") return listed;

  const closure = ctx.canFinish();
  const premature = ctx.find("calls", {}).length === 0 || closure === null;
  if (listed.list.length === 0 && premature) {
    listed = await listPending(env, input);
    if (listed.kind !== "listed") return listed;
  }

  if (listed.list.length > 0) return { kind: "next", list: listed.list };
  if (closure !== null) return { kind: "done", closure };
  return { kind: "next", list: [ctx.task.request] };
}
