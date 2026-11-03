/**
 * JARVIS Core — Bucle de un paso (`runStep`, Fase 5; PLAN_CONTEXT 5.2, 5.3 y 5.4; PLAN_FLUJO 2, 3, 4 y 6).
 *
 * Ciclo de vida:
 * - Reactivo: el paso se CREA en `running` (apply lo crea así cuando `planId = null`) ANTES de consultar a Decisión 1.
 * - Deliberativo: el paso `pending` del plan pasa a `running`; su ruta viene del plan.
 * - Termina `completed` cuando una llamada queda `approved`, o por `fin` (reactivo); termina `failed` al agotar el tope de
 *   llamadas, ante un `denied` del servidor o sin opciones disponibles (`no_tools`). La recuperación del modo (escalación o
 *   replan) es de la Fase 6.
 *
 * Decisión 1 corre en cada vuelta, en ambos modos. Sus opciones: en reactivo, las rutas con alguna herramienta usable,
 * `ask_user` (si `ctx.canAsk`) y `fin` (si `canFinish()` lo habilita); en deliberativo, la ruta del paso (si es usable) y
 * `ask_user`. Con una sola opción Decision no consulta al modelo. Sin ninguna, el paso queda `failed` (`no_tools`).
 *
 * Qué pasa tras cada llamada registrada: `approved` → paso `completed`; `denied` del servidor → `failed` (no se verifica);
 * cualquier otro resultado (`args_invalid`, `refs_unresolved`, `tool_rejected`, `info_missing`, `loop_blocked`,
 * `user_rejected`, veredicto `rejected`) → vuelve a Decisión 1 con lo ocurrido a la vista. No hay contadores de reintento:
 * el único tope es el de llamadas por paso, `BUDGET.maxCallsPerStep` (sin `user_rejected`).
 *
 * `ask_user` (Decisión 1 o 2): se espera la respuesta aquí y el bucle sigue con el hecho `answer_<stepId>_<n>` ya
 * escrito; no se vuelve a ofrecer hasta que el paso haga otra llamada (`ctx.canAsk`).
 *
 * Esta función NUNCA llama a `finish` ni escribe `result` (Fase 6): devuelve un `StepOutcome`. Ante un cierre, el paso
 * queda como estaba.
 */

import type { ExecutableRoute } from "../types/routes.ts";
import { ASK_USER, EXECUTABLE_ROUTES, FIN, isExecutableRoute } from "../types/routes.ts";
import { routeInput, routeViewOptions } from "./adapters.ts";
import { askUser } from "./ask.ts";
import { availableRoutes, runCall } from "./callRunner.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, queryModel } from "./failures.ts";
import type { CallOutcome, StepFailureCause, StepOutcome } from "./outcomes.ts";
import { callCapReached, canAskUser } from "./retries.ts";

/** Cómo empieza el paso: reactivo lo crea; deliberativo promueve el `pending` que indica el proveedor. */
export type StepSeed = { readonly kind: "reactive" } | { readonly kind: "planned"; readonly stepId: string };

const CANCELLED: StepOutcome = { kind: "cancelled" };

export async function runStep(env: EngineEnv, seed: StepSeed): Promise<StepOutcome> {
  const { ctx, runtime } = env;
  if (runtime.cancelled || ctx.isClosed()) return CANCELLED;

  const reactive = ctx.task.mode === "reactive";
  if (reactive !== (seed.kind === "reactive")) throw new Error(`runStep: la semilla '${seed.kind}' no corresponde al modo '${ctx.task.mode}'.`);

  // ── Abrir el paso.
  let stepId: string;
  let plannedRoute: ExecutableRoute | null = null;
  if (seed.kind === "reactive") {
    stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: null, route: null, expected: null } }).ids[0];
  } else {
    stepId = seed.stepId;
    const planned = ctx.find("steps", { id: stepId })[0];
    if (planned === undefined) throw new Error(`runStep: el paso ${stepId} no existe.`);
    if (!isExecutableRoute(planned.route)) throw new Error(`runStep: el paso ${stepId} tiene una ruta no ejecutable (${String(planned.route)}).`);
    plannedRoute = planned.route;
    ctx.apply({ op: "update", target: stepId, value: { state: "running" } });
  }

  const finishStep = (state: "completed" | "failed"): void => {
    ctx.apply({ op: "update", target: stepId, value: { state } });
  };
  const failStep = (cause: StepFailureCause): StepOutcome => {
    finishStep("failed");
    return { kind: "failed", cause };
  };

  /** `ask_user`: pregunta, espera y deja el hecho escrito; `null` si el bucle puede seguir. */
  const ask = async (): Promise<StepOutcome | null> => {
    const asked = await askUser(env, stepId);
    if (asked.kind === "answered") return null;
    return asked.kind === "cancelled" ? CANCELLED : { kind: "close", stopReason: asked.stopReason };
  };

  for (; ;) {
    if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
    if (callCapReached(ctx, stepId)) return failStep("call_cap");

    // ── Destino de la llamada: Decisión 1 en ambos modos.
    const routes = await availableRoutes(env, reactive ? EXECUTABLE_ROUTES : [plannedRoute as ExecutableRoute]);
    if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
    const allowFin = reactive && ctx.canFinish() !== null;
    const allowAsk = canAskUser(ctx, stepId);
    if (routes.length === 0 && !allowFin && !allowAsk) return failStep("no_tools");

    const input = routeInput(ctx.view.forRoute(routeViewOptions()), { routes, allowFin, allowAsk });
    const query = await queryModel(() => env.decision.chooseRoute(input, runtime.signal));
    if (!query.ok) {
      const closure = closeOnFailure(ctx, stepId, query.failure, query.error);
      return closure.kind === "cancelled" ? CANCELLED : { kind: "close", stopReason: closure.stopReason };
    }
    if (runtime.cancelled || ctx.isClosed()) return CANCELLED;

    const decision = query.value;
    if (decision.action === FIN) {
      // `fin` solo se ofrece si `canFinish()` no es `null`; el criterio de Decision no permite otra cosa.
      const closure = ctx.canFinish();
      if (closure === null) throw new Error("runStep: Decision eligió 'fin' sin que el cierre esté permitido.");
      finishStep("completed");
      return { kind: "fin", closure };
    }
    if (decision.action === ASK_USER) {
      const stop = await ask();
      if (stop !== null) return stop;
      continue;
    }
    const route = decision.route;

    // ── La llamada.
    const outcome: CallOutcome = await runCall(env, { stepId, route });

    switch (outcome.kind) {
      case "cancelled":
        return CANCELLED;
      case "close":
        return { kind: "close", stopReason: outcome.stopReason };
      case "no_tools":
        return failStep("no_tools");
      case "ask_user": {
        const stop = await ask();
        if (stop !== null) return stop;
        continue;
      }
      case "registered":
        break;
    }

    // ── Qué sigue tras una llamada registrada: aprobada cierra el paso; `denied` del servidor lo falla; el resto vuelve a
    // Decisión 1 (solo cuenta el tope de llamadas, que se revisa al inicio de la vuelta).
    if (outcome.verdict === "approved") {
      finishStep("completed");
      return { kind: "completed" };
    }
    if (outcome.status === "denied") return failStep("server_denied");
  }
}