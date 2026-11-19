/**
 * JARVIS Core — Ejecución de una tarea de principio a fin (Fase 6; PLAN_FLUJO 3, 6, 7 y 9).
 *
 * `runTask` es el único que decide cuándo y cómo cierra la tarea: ejecuta los pasos (`runStep`), aplica la recuperación del
 * modo y llama a `finalize` una sola vez. Los topes son los de la tabla única (`BUDGET`).
 *
 * Reactivo: cada vuelta es un paso nuevo cuya instrucción es el primer pendiente de una lista que mantiene el código
 * (`pendingList.ts`; el modelo la genera al empezar y se le consulta de nuevo solo tras un fallo o al vaciarse). Un paso que
 * termina bien quita su ítem; un ítem nunca se abandona. Tras un paso fallido se le pide al modelo que reescriba el ítem: una reescritura DISTINTA es un intento nuevo
 * (no hereda ningún conteo); si `pending` repite exactamente el texto normalizado del ítem fallido (Decisión trabaja con temperatura 0: el mismo texto da la misma
 * respuesta, ya se sabe que fallará; salvo un reintento idéntico por ítem si el paso falló por errores de la herramienta), responde `done` o solo ítems ya cumplidos, u omite el ítem fallido y sigue con uno de los que venían detrás (que pueden depender
 * de él), la tarea cierra `no_alternatives` (`partial` si hubo efectos o llamadas aprobadas, `failed` si no). Al terminar bien el último ítem, Decisión 5 (`completion.ts`) puede cerrar `completed` sin consultar al LLM. Una lista vacía confirmada por el modelo cierra `completed` o
 * `no_alternatives`, según `canFinish()`; `max_steps` al llegar a `BUDGET.maxSteps` pasos (los `failed` cuentan); una racha de pasos `failed` SEGUIDOS (sin un paso
 * completado en el medio) por encima de `BUDGET.maxEscalations` cierra `no_alternatives`: un paso que termina bien reinicia la cuenta.
 *
 * Deliberativo: plan inicial (LLM 1) y confirmación del usuario. Rechazarlo con instrucción da un plan `user_feedback`
 * (sin tope) y se vuelve a pedir la confirmación; si ese plan es inválido se conserva el vigente y se vuelve a pedir;
 * rechazarlo sin instrucción cancela. Aceptado, se ejecutan los pasos vigentes; un paso `failed` dispara un replan
 * (`step_failure`, sin confirmación) hasta `BUDGET.maxReplans`; sin replans o con el replan inválido,
 * `replans_exhausted`. Todos los pasos vigentes `completed` cierran con `completed` (`planClosure`).
 *
 * Un plan inicial inválido o un servicio caído cierran con `unrecoverable`; la cancelación en cualquier punto, con
 * `user_cancelled`. Una denegación del Guard ya no cierra la tarea (falla, a lo sumo, el paso): `security_denied` queda solo para leer trazas anteriores.
 */

import { planClosure } from "../ctx/index.ts";
import type { StopReason, TaskContext } from "../ctx/index.ts";
import type { EngineDeps } from "../contracts.ts";
import { createEngineEnv } from "./env.ts";
import type { EngineEnv } from "./env.ts";
import { finalize } from "./finalize.ts";
import { COMPLETION_INCOMPLETE_BELOW, confirmCompletion } from "./completion.ts";
import { escalationsExceeded, replansExhausted, stepsExhausted } from "./limits.ts";
import type { Closing } from "./finalize.ts";
import { classifyRequest, detectContinuation } from "./classify.ts";
import { generatePending } from "./pending.ts";
import { ReactiveList } from "./reactiveList.ts";
import { shadowRecovery } from "./recoveryShadow.ts";
import { confirmPlan, generatePlan } from "./planner.ts";
import type { PlanOutcome } from "./planner.ts";
import { recordInitialRecalled, recordUserMemory } from "./recalled.ts";
import type { TaskRuntime } from "./runtime.ts";
import { runStep } from "./stepLoop.ts";

const COMPLETED: Closing = { stopReason: null };
const stop = (stopReason: StopReason): Closing => ({ stopReason });
const CANCELLED = stop("user_cancelled");

/** Cierre de un plan que no quedó registrado: cancelación o servicio caído; una generación inválida es `unrecoverable`. */
function planStop(outcome: Exclude<PlanOutcome, { readonly kind: "planned" }>): Closing {
  switch (outcome.kind) {
    case "cancelled":
      return CANCELLED;
    case "close":
      return stop(outcome.stopReason);
    case "invalid":
      return stop("unrecoverable");
  }
}

/** Ejecuta la tarea hasta su cierre: estado terminal y respuesta final quedan escritos en el contexto. */
export async function runTask(ctx: TaskContext, runtime: TaskRuntime, deps: EngineDeps): Promise<void> {
  const env = createEngineEnv(ctx, runtime, deps);
  try {
    const closing = ctx.task.mode === "reactive" ? await runReactive(env) : await runDeliberative(env);
    await finalize(env, closing);
  } finally {
    // Cancelada, fallida, parcial o con un error interno: cada proveedor cierra lo que la tarea dejó corriendo (procesos en segundo plano).
    // Completada: se conserva (pudo ser lo pedido).
    const state = ctx.task.state;
    await deps.discovery.notifyTaskEnd?.(ctx.task.id, state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "failed");
  }
}

async function runReactive(env: EngineEnv): Promise<Closing> {
  const { ctx, runtime } = env;
  // La lista la mantiene el código (`reactiveList.ts`): el modelo la genera al empezar, el paso que termina bien quita su ítem, y solo se consulta al modelo tras un
  // fallo (reescribir el ítem) o al vaciarse (confirmar que no falta nada). Acá queda el flujo: qué consultar y cuándo cerrar.
  const list = new ReactiveList();

  // Cierre con la lista vacía (inicio o confirmación D5): decide `canFinish()`.
  const finishEmpty = (closure: "completed" | "no_alternatives" | null): Closing =>
    closure !== "completed" ? stop("no_alternatives") : COMPLETED;

  // D0: una consulta de decisión sobre la solicitud antes de `pending`. Charla: sin llamadas, la tarea cierra completada y la respuesta final contesta (hoy cuesta
  // dos consultas a `pending`). Una acción: la lista es la solicitud literal y el paso la recibe sin reescritura. Varias acciones, o una respuesta de D0 que no sirve (inválida o desborde): el flujo de siempre. Con el modelo de decisión no disponible rige la pausa (`queryModel`) y, agotada, la tarea cierra.
  // Hilo: si el pedido continúa la tarea anterior («guardalo en un md»), esa tarea entra a `pending`, a los argumentos y a la respuesta final. Con hilo, una acción no toma
  // el atajo (la solicitud literal dice «eso»): `pending` la reescribe con la tarea anterior a la vista. Una charla sí cierra directo: la respuesta final ve el hilo.
  const continuation = await detectContinuation(env);
  if (continuation.kind === "cancelled") return CANCELLED;
  if (continuation.kind === "close") return stop(continuation.stopReason);
  env.state.thread = continuation.previous;
  await recordInitialRecalled(env);
  if (runtime.cancelled) return CANCELLED;
  const classification = await classifyRequest(env);
  if (classification.kind === "cancelled") return CANCELLED;
  if (classification.kind === "close") return stop(classification.stopReason);
  const first = classification.first;
  if (first === "chat") return COMPLETED;
  if (first === "single" && env.state.thread === null) list.seed([ctx.task.request]);

  for (;;) {
    if (runtime.cancelled) return CANCELLED;
    if (stepsExhausted(ctx)) return stop("max_steps");

    if (list.needsModel) {
      // Lo que Decisión 5 dijo justo antes de esta consulta (si fue ella la que la provocó); se consume acá para que no valga en una consulta posterior.
      const completionBefore = env.state.lastCompletion;
      env.state.lastCompletion = null;
      const next = await generatePending(env, list.pending);
      switch (next.kind) {
        case "next":
          {
            const transition = list.applyModelList(next.list, completionBefore !== null && completionBefore < COMPLETION_INCOMPLETE_BELOW);
            if (transition !== "accepted" && transition !== "identical_retry") return stop("no_alternatives");
          }
          break;
        case "done":
          if (list.applyModelDone() === "rejected") return stop("no_alternatives");
          if (list.isEmpty) return finishEmpty(next.closure);
          break;
        case "close":
          return stop(next.stopReason);
        case "cancelled":
          return CANCELLED;
      }
      if (list.isEmpty) return finishEmpty(ctx.canFinish());
      list.modelAnswered();
    }

    const outcome = await runStep(env, { kind: "reactive", instruction: list.head });
    switch (outcome.kind) {
      case "completed": {
        list.completeHead();
        if (list.isEmpty) {
          // Hecho todo lo previsto: Decisión 5 dice si la solicitud está cumplida (cierra sin llamar al LLM)
          // y, si no lo asegura, se confirma con el LLM que no falta nada.
          const completion = await confirmCompletion(env);
          if (completion.kind === "complete") return COMPLETED;
          if (completion.kind === "cancelled") return CANCELLED;
          if (completion.kind === "close") return stop(completion.stopReason);
          list.askModelToConfirm();
        }
        continue;
      }
      case "failed":
        // Una racha de pasos fallidos sin ningún paso completado en el medio agota la recuperación (`BUDGET.maxEscalations`). Antes de eso, se reescribe el ítem; si el
        // modelo lo repite idéntico, se cierra (`applyModelList`).
        if (escalationsExceeded(ctx)) return stop("no_alternatives");
        await shadowRecovery(env, list.pending, outcome.cause); // modo sombra: registra qué haría `recovery`, no actúa
        list.failHead(outcome.cause);
        continue;
      case "close":
        return stop(outcome.stopReason);
      case "cancelled":
        return CANCELLED;
    }
  }
}

async function runDeliberative(env: EngineEnv): Promise<Closing> {
  const { ctx, runtime } = env;

  await recordUserMemory(env, ctx.task.request, null);
  if (runtime.cancelled) return CANCELLED;

  // ── Plan inicial y su confirmación.
  const initial = await generatePlan(env, { kind: "initial" });
  if (initial.kind !== "planned") return planStop(initial);
  let planId = initial.planId;
  for (;;) {
    const decision = await confirmPlan(env, planId);
    if (decision.kind === "approved") break;
    if (decision.kind === "cancelled" || decision.instruction === null) return CANCELLED;
    const revised = await generatePlan(env, { kind: "user_feedback", feedback: decision.instruction });
    if (revised.kind === "planned") planId = revised.planId;
    else if (revised.kind !== "invalid") return planStop(revised); // inválido: se conserva el plan vigente y se vuelve a pedir
  }

  // ── Ejecución de los pasos vigentes.
  for (;;) {
    if (runtime.cancelled) return CANCELLED;
    if (planClosure(ctx.find("steps", {})) === "completed") return COMPLETED;

    const current = ctx.current().step;
    if (current === null) throw new Error("runTask: no hay un paso vigente por ejecutar y el plan no está cerrado.");

    const outcome = await runStep(env, { kind: "planned", stepId: current.id });
    switch (outcome.kind) {
      case "completed":
        continue;
      case "failed": {
        if (replansExhausted(ctx)) return stop("replans_exhausted");
        const replan = await generatePlan(env, { kind: "step_failure" });
        if (replan.kind === "planned") continue;
        return replan.kind === "invalid" ? stop("replans_exhausted") : planStop(replan);
      }
      case "close":
        return stop(outcome.stopReason);
      case "cancelled":
        return CANCELLED;
    }
  }
}
