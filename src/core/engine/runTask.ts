/**
 * JARVIS Core — Ejecución de una tarea de principio a fin (Fase 6; PLAN_FLUJO 3, 6, 7 y 9).
 *
 * `runTask` es el único que decide cuándo y cómo cierra la tarea: ejecuta los pasos (`runStep`), aplica la recuperación del
 * modo y llama a `finalize` una sola vez. Los topes son los de la tabla única (`BUDGET`).
 *
 * Reactivo: cada vuelta es un paso nuevo cuya instrucción es el primer pendiente de una lista que mantiene el código
 * (`pendingList.ts`; el modelo la genera al empezar y se le consulta de nuevo solo tras un fallo o al vaciarse). Un paso que
 * termina bien quita su ítem; un ítem con `BUDGET.maxItemFailures` pasos fallidos seguidos se abandona si quedan otros, y la tarea
 * cierra `no_alternatives` (parcial) cuando se vacía. Una lista vacía confirmada por el modelo cierra `completed` o
 * `no_alternatives`, según `canFinish()`; `max_steps` al llegar a `BUDGET.maxSteps` pasos (los `failed` cuentan); un paso `failed`
 * es una escalación: al tercero, `no_alternatives`.
 *
 * Deliberativo: plan inicial (LLM 1) y confirmación del usuario. Rechazarlo con instrucción da un plan `user_feedback`
 * (sin tope) y se vuelve a pedir la confirmación; si ese plan es inválido se conserva el vigente y se vuelve a pedir;
 * rechazarlo sin instrucción cancela. Aceptado, se ejecutan los pasos vigentes; un paso `failed` dispara un replan
 * (`step_failure`, sin confirmación) hasta `BUDGET.maxReplans`; sin replans o con el replan inválido,
 * `replans_exhausted`. Todos los pasos vigentes `completed` cierran con `completed` (`planClosure`).
 *
 * Un plan inicial inválido o un servicio caído cierran con `unrecoverable`; la cancelación en cualquier punto, con
 * `user_cancelled`. `security_denied` viene del Guard (`runStep`).
 */

import { BUDGET } from "../budget.ts";
import { planClosure } from "../ctx/index.ts";
import type { StopReason, TaskContext } from "../ctx/index.ts";
import type { EngineDeps } from "../contracts.ts";
import { createEngineEnv } from "./env.ts";
import type { EngineEnv } from "./env.ts";
import { finalize } from "./finalize.ts";
import type { Closing } from "./finalize.ts";
import { generatePending } from "./pending.ts";
import { reconcileList } from "./pendingList.ts";
import { confirmPlan, generatePlan } from "./planner.ts";
import type { PlanOutcome } from "./planner.ts";
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
  const closing = ctx.task.mode === "reactive" ? await runReactive(env) : await runDeliberative(env);
  await finalize(env, closing);
}

async function runReactive(env: EngineEnv): Promise<Closing> {
  const { ctx, runtime } = env;
  // La lista la mantiene el código (ver `pendingList.ts`): el modelo la genera al empezar, el paso que termina bien quita su ítem,
  // y solo se consulta al modelo tras un fallo (reescribir el ítem) o al vaciarse (confirmar que no falta nada).
  let pending: readonly string[] = [];
  let askModel = true;
  const settled: string[] = []; // ítems cumplidos o abandonados: el modelo no los vuelve a agregar
  let abandoned = 0;
  let headFailures = 0; // pasos fallidos seguidos sobre el ítem de adelante

  // Cierre con la lista vacía: abandonar un ítem deja la tarea incompleta; si no, decide `canFinish()`.
  const finishEmpty = (closure: "completed" | "no_alternatives" | null): Closing =>
    abandoned > 0 || closure !== "completed" ? stop("no_alternatives") : COMPLETED;

  for (;;) {
    if (runtime.cancelled) return CANCELLED;
    if (ctx.find("steps", {}).length >= BUDGET.maxSteps) return stop("max_steps");

    if (askModel) {
      const previous = pending;
      const next = await generatePending(env, previous);
      switch (next.kind) {
        case "next":
          pending = reconcileList(next.list, previous, settled);
          break;
        case "done":
          // El modelo dice que no queda nada; si el código tiene ítems detrás del que falló, siguen.
          pending = reconcileList([], previous, settled);
          if (previous.length > 0 && pending.length < previous.length) {
            settled.push(previous[0]);
            abandoned++;
          }
          if (pending.length === 0) return finishEmpty(next.closure);
          break;
        case "close":
          return stop(next.stopReason);
        case "cancelled":
          return CANCELLED;
      }
      if (pending.length === 0) return finishEmpty(ctx.canFinish());
      askModel = false;
    }

    const head = pending[0];
    const outcome = await runStep(env, { kind: "reactive", instruction: head });
    switch (outcome.kind) {
      case "completed":
        settled.push(head);
        pending = pending.slice(1);
        headFailures = 0;
        if (pending.length === 0) {
          // Hecho todo lo previsto: si se abandonó algo, la tarea es parcial; si no, se confirma con el modelo que no falta nada.
          if (abandoned > 0) return stop("no_alternatives");
          askModel = true;
        }
        continue;
      case "failed":
        // Un paso `failed` es una escalación; el tercero agota la recuperación.
        if (ctx.escalations() > BUDGET.maxEscalations) return stop("no_alternatives");
        headFailures++;
        if (headFailures >= BUDGET.maxItemFailures && pending.length > 1) {
          // Salida parcial: el ítem agotó sus intentos y quedan otros (p. ej. guardar lo obtenido): se sigue con el resto.
          settled.push(head);
          abandoned++;
          pending = pending.slice(1);
          headFailures = 0;
        } else {
          askModel = true;
        }
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
        if (ctx.replansDone() >= BUDGET.maxReplans) return stop("replans_exhausted");
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
