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
 * `ask_user` no es una opción de Decision: se pregunta aquí (`BUDGET.maxQuestionsPerStep` las del modelo, `BUDGET.maxProcessPromptsPerStep` las de procesos), cuando la
 * revisión de argumentos registra `info_missing`, cuando una llamada queda `waiting_input` (un proceso que pide una respuesta) o cuando el paso
 * llegaría al tope de llamadas (antes de fallar). Se espera
 * la respuesta y el bucle sigue con el hecho `answer_<stepId>_<n>` ya escrito.
 *
 * Esta función NUNCA llama a `finish` ni escribe `result` (Fase 6): devuelve un `StepOutcome`. Ante un cierre, el paso
 * queda como estaba.
 */

import type { ExecutableRoute } from "../types/routes.ts";
import { EXECUTABLE_ROUTES, isExecutableRoute } from "../types/routes.ts";
import { routeInput, routeViewOptions } from "./adapters.ts";
import { askUser, processAnswerSuffix, processQuestion } from "./ask.ts";
import { availableRoutes, runCall } from "./callRunner.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, queryModel } from "./failures.ts";
import type { CallOutcome, StepFailureCause, StepOutcome } from "./outcomes.ts";
import { checkStepLimits } from "./limits.ts";
import { canAskProcessPrompt, canAskUser, repeatsApprovedCall } from "./retries.ts";

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

  /** Pregunta al usuario, espera y deja el hecho escrito; `null` si el bucle puede seguir. `literalQuestion`: pregunta ya armada (un proceso que espera entrada). */
  const ask = async (literalQuestion?: string, keySuffix?: string): Promise<StepOutcome | null> => {
    const asked = await askUser(env, stepId, literalQuestion, keySuffix);
    if (asked.kind === "answered") return null;
    return asked.kind === "cancelled" ? CANCELLED : { kind: "close", stopReason: asked.stopReason };
  };

  for (; ;) {
    if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
    // El único punto de control de los topes del paso (`limits.ts`). Un atasco por llamadas pregunta al usuario antes de fallar (si no se le
    // preguntó ya en este paso); el paso falla igual y la respuesta queda a la vista de lo que siga (siguiente paso o replan).
    const hit = checkStepLimits(ctx, stepId);
    if (hit !== null) {
      if (!hit.askFirst || !canAskUser(ctx, stepId)) return failStep(hit.cause);
      const stop = await ask();
      return stop ?? failStep(hit.cause);
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

    // ── Qué sigue tras una llamada registrada: aprobada cierra el paso; `info_missing` pregunta al usuario (si todavía se puede); el resto, incluidas
    // las denegaciones (Guard o lista negra: `tool_rejected`; servidor: `denied`), vuelve a Decisión 1 con el motivo a la vista. Los topes (también
    // `maxDeniedPerStep`) se revisan al inicio de la vuelta.
    if (outcome.verdict === "approved") {
      finishStep("completed");
      return { kind: "completed" };
    }
    if (outcome.status === "loop_blocked") {
      // Pedir otra vez lo que ya salió bien es haberlo terminado; pedir otra vez lo que falló, dos veces, es un atasco.
      if (repeatsApprovedCall(ctx, outcome.callId)) {
        finishStep("completed");
        return { kind: "completed" };
      }
    }
    if (outcome.status === "info_missing" && canAskUser(ctx, stepId)) {
      const stop = await ask();
      if (stop !== null) return stop;
    }
    // Un proceso que sigue vivo y espera una respuesta: no hay resultado que verificar, se le pregunta al usuario lo que el proceso pide y la respuesta
    // vuelve en la siguiente llamada. Con su propio tope (`maxProcessPromptsPerStep`): un prompt más allá de él lo acaba el tope de llamadas.
    if (outcome.status === "waiting_input" && outcome.prompt !== undefined && outcome.pid !== undefined && canAskProcessPrompt(ctx, stepId)) {
      const stop = await ask(processQuestion(outcome.prompt), processAnswerSuffix(outcome.pid));
      if (stop !== null) return stop;
    }
    // Los demás topes (repeticiones, rechazos del usuario, argumentos inválidos, ejecuciones e intentos) los revisa `checkStepLimits` al volver al inicio.
  }
}