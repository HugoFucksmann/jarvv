/**
 * JARVIS Core — Pregunta al usuario (`ask_user`, Fase 5).
 *
 * Cuando Decision elige `ask_user` (en Decision #1 o #2), `runStep` llama a `askUser`:
 *
 * 1. Se genera el texto de la pregunta con el LLM a partir de `forAsk` (`generateQuestion`). Una salida inválida ya se
 *    reintentó una vez dentro de Qwen; si persiste, o el servicio cae, `service_unavailable` (D29). Sin texto de reserva.
 * 2. Se espera la respuesta en el `TaskRuntime` (la espera no vive en el contexto, 5.3). La cancelación resuelve la espera.
 * 3. Se escribe el hecho `answer_<stepId>_<n>` = `pregunta -> respuesta` (n = número de la pregunta en el paso), recortado
 *    al tope de un hecho con `clipWithin` (D23). Si se recortó, el texto completo va al almacén y a `refs` en el mismo
 *    `apply` (D13). Un fallo del almacén conserva el hecho recortado, registra `service_unavailable` y cierra la tarea (D7).
 *
 * No se registra ninguna llamada. La pregunta no tiene tope propio: `ask_user` deja de ofrecerse mientras el paso no tenga
 * una llamada posterior a la última respuesta (`ctx.canAsk`); lo cortan el tope de llamadas y el anti-loop.
 */

import { BUDGET } from "../budget.ts";
import type { Op } from "../ctx/index.ts";
import { RefVaultError } from "../refs/refVault.ts";
import { renderAsk } from "../render/index.ts";
import { askRenderOptions } from "./adapters.ts";
import { clipWithin, withLineCount } from "./args.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, queryModel } from "./failures.ts";

export type AskOutcome =
  | { readonly kind: "answered" }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

const UNRECOVERABLE: AskOutcome = { kind: "close", stopReason: "unrecoverable" };

export async function askUser(env: EngineEnv, stepId: string): Promise<AskOutcome> {
  const { ctx, runtime, deps } = env;

  // `forAsk` no muestra efectos: no desborda.
  const view = renderAsk(ctx.view.forAsk(), askRenderOptions());

  // El LLM ya reintentó una vez una salida inválida (Qwen): aquí no se repite (D29).
  const generated = await queryModel(() => env.llm.generateQuestion({ view }, runtime.signal), 0);
  if (!generated.ok) {
    const closure = closeOnFailure(ctx, stepId, generated.failure, generated.error);
    return closure.kind === "cancelled" ? { kind: "cancelled" } : UNRECOVERABLE;
  }
  if (runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };

  const question = generated.value.question;
  const outcome = await runtime.askUser({ stepId, question });
  if (outcome.kind === "cancelled" || runtime.cancelled || ctx.isClosed()) return { kind: "cancelled" };

  const full = `${question} -> ${outcome.answer}`;
  const value = clipWithin(full, BUDGET.factValueMax);
  const key = ctx.nextAnswerKey(stepId);
  const setFact: Op = { op: "set", target: `facts.${key}`, value: { value, stepId } };

  if (value === full) {
    ctx.apply(setFact);
    return { kind: "answered" };
  }

  // Recortado: el texto completo va a disco y a `refs`; si el almacén falla se conserva el hecho recortado (D7).
  try {
    const stored = await deps.vault.put(ctx.task.id, full);
    if (ctx.isClosed()) return { kind: "cancelled" };
    ctx.apply([
      { op: "add", target: "refs", value: { stepId, label: withLineCount(key, full), size: stored.size, where: stored.where } },
      setFact,
    ]);
    return { kind: "answered" };
  } catch (error) {
    if (!(error instanceof RefVaultError)) throw error;
    console.error(`[Engine] no se pudo guardar la respuesta completa del usuario: ${error.message}`);
    if (ctx.isClosed()) return { kind: "cancelled" };
    ctx.apply([setFact, { op: "add", target: "errors", value: { stepId, kind: "service_unavailable" } }]);
    return UNRECOVERABLE;
  }
}