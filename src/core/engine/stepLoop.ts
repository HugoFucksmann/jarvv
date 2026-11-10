/**
 * JARVIS Core — Bucle de un paso (`runStep`, Fase 5; PLAN_CONTEXT 5.2, 5.3 y 5.4; PLAN_FLUJO 2, 3, 4 y 6).
 *
 * Ciclo de vida:
 * - Reactivo: el paso se CREA en `running` (apply lo crea así cuando `planId = null`), con el primer pendiente como
 *   instrucción, ANTES de consultar a Decisión 1.
 * - Deliberativo: el paso `pending` del plan pasa a `running`; su ruta viene del plan.
 * - Termina `completed` cuando una llamada queda `approved`; termina `failed` al agotar el tope de llamadas, al segundo
 *   rechazo de la revisión (`args_invalid`), ante un `denied` del servidor o sin opciones disponibles
 *   (`no_tools`). La recuperación del modo (escalación o replan) es de la Fase 6.
 *
 * Decisión 1 corre en cada vuelta, en ambos modos. Sus opciones: en reactivo, las rutas con alguna herramienta usable; en
 * deliberativo, la ruta del paso (si es usable). Con una sola opción Decision no consulta al modelo. Sin ninguna, el paso
 * queda `failed` (`no_tools`).
 *
 * Qué pasa tras cada llamada registrada: `approved` → paso `completed`; `denied` del servidor → `failed` (no se verifica);
 * `loop_blocked` contra una llamada idéntica ya aprobada → paso `completed` (lo pedido ya está hecho); el segundo `loop_blocked` del
 * paso (`BUDGET.maxRepeatsPerStep`) → `failed`; cualquier otro resultado (`args_invalid`, `refs_unresolved`, `info_missing`,
 * `loop_blocked`, `user_rejected`, veredicto `rejected`) → vuelve a Decisión 1 con lo ocurrido a la vista. Topes del paso:
 * `BUDGET.maxCallsPerStep` (sin `user_rejected`), `BUDGET.maxRepeatsPerStep` y `BUDGET.maxUserRejectionsPerStep` (el segundo rechazo del usuario falla el paso).
 *
 * `ask_user` no es una opción de Decision: se pregunta aquí, una vez por paso (`BUDGET.maxQuestionsPerStep`), cuando la
 * revisión de argumentos registra `info_missing` o cuando el paso llegaría al tope de llamadas (antes de fallar). Se espera
 * la respuesta y el bucle sigue con el hecho `answer_<stepId>_<n>` ya escrito.
 *
 * Esta función NUNCA llama a `finish` ni escribe `result` (Fase 6): devuelve un `StepOutcome`. Ante un cierre, el paso
 * queda como estaba.
 */

import type { ExecutableRoute } from "../types/routes.ts";
import { EXECUTABLE_ROUTES, isExecutableRoute } from "../types/routes.ts";
import { routeInput, routeViewOptions } from "./adapters.ts";
import { askUser } from "./ask.ts";
import { availableRoutes, runCall } from "./callRunner.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, queryModel } from "./failures.ts";
import type { CallOutcome, StepFailureCause, StepOutcome } from "./outcomes.ts";
import { callCapReached, canAskUser, repeatsApprovedCall, repeatsReached, reviewRejectionsReached, userRejectionsReached } from "./retries.ts";

/** Cómo empieza el paso: reactivo lo crea; deliberativo promueve el `pending` que indica el proveedor. */
export type StepSeed = { readonly kind: "reactive"; readonly instruction: string } | { readonly kind: "planned"; readonly stepId: string };

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
    stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: seed.instruction, route: null, expected: null } }).ids[0];
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

  /** Pregunta al usuario, espera y deja el hecho escrito; `null` si el bucle puede seguir. */
  const ask = async (): Promise<StepOutcome | null> => {
    const asked = await askUser(env, stepId);
    if (asked.kind === "answered") return null;
    return asked.kind === "cancelled" ? CANCELLED : { kind: "close", stopReason: asked.stopReason };
  };

  for (; ;) {
    if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
    if (callCapReached(ctx, stepId)) {
      // Atasco: antes de fallar se le pregunta al usuario (si no se le preguntó ya en este paso); el paso falla igual y la
      // respuesta queda a la vista de lo que siga (siguiente paso o replan).
      if (!canAskUser(ctx, stepId)) return failStep("call_cap");
      const stop = await ask();
      return stop ?? failStep("call_cap");
    }

    // ── Destino de la llamada: Decisión 1 en ambos modos.
    const routes = await availableRoutes(env, stepId, reactive ? EXECUTABLE_ROUTES : [plannedRoute as ExecutableRoute]);
    if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
    if (routes.length === 0) return failStep("no_tools");

    const input = routeInput(ctx.view.forRoute(routeViewOptions()), { routes });
    const query = await queryModel(() => env.decision.chooseRoute(input, runtime.signal));
    if (!query.ok) {
      const closure = closeOnFailure(ctx, stepId, query.failure, query.error);
      return closure.kind === "cancelled" ? CANCELLED : { kind: "close", stopReason: closure.stopReason };
    }
    if (runtime.cancelled || ctx.isClosed()) return CANCELLED;

    const route = query.value.route;

    // ── La llamada.
    const outcome: CallOutcome = await runCall(env, { stepId, route });

    switch (outcome.kind) {
      case "cancelled":
        return CANCELLED;
      case "close":
        return { kind: "close", stopReason: outcome.stopReason };
      case "no_tools":
        return failStep("no_tools");
      case "registered":
        break;
    }

    // ── Qué sigue tras una llamada registrada: aprobada cierra el paso; `denied` del servidor lo falla; `info_missing`
    // pregunta al usuario (si todavía se puede); el resto vuelve a Decisión 1 (solo cuenta el tope de llamadas, que se
    // revisa al inicio de la vuelta).
    if (outcome.verdict === "approved") {
      finishStep("completed");
      return { kind: "completed" };
    }
    if (outcome.status === "denied") return failStep("server_denied");
    if (outcome.status === "loop_blocked") {
      // Pedir otra vez lo que ya salió bien es haberlo terminado; pedir otra vez lo que falló, dos veces, es un atasco.
      if (repeatsApprovedCall(ctx, outcome.callId)) {
        finishStep("completed");
        return { kind: "completed" };
      }
      if (repeatsReached(ctx, stepId)) return failStep("repeat_blocked");
    }
    if (outcome.status === "info_missing" && canAskUser(ctx, stepId)) {
      const stop = await ask();
      if (stop !== null) return stop;
    }
    // El usuario rechazó la confirmación dos veces: el paso falla (su instrucción queda a la vista de lo que siga).
    if (outcome.status === "user_rejected" && userRejectionsReached(ctx, stepId)) return failStep("user_rejected");
    // La revisión rechazó la herramienta o los argumentos más de una vez: el paso falla y la recuperación del modo lo reencauza.
    if (reviewRejectionsReached(ctx, stepId)) return failStep("review_rejected");
  }
}