/**
 * JARVIS Core — Planificador y confirmación del plan (Fase 6, solo deliberativo; PLAN_FLUJO 6 y 7).
 *
 * `generatePlan` consulta a LLM 1 con `forPlan` y registra el resultado: primero el plan y después sus pasos (dos `apply`,
 * porque un lote no puede usar ids que él mismo crea). Un plan nuevo (`step_failure` o `user_feedback`) deja `superseded`
 * los pasos que no están `completed` en el mismo lote que agrega los nuevos (5.2). Qué hace el cierre con cada resultado es
 * de `runTask`; aquí solo se registra lo que ocurrió y se devuelve qué sigue.
 *
 * - El tipo de plan lo decide quien llama; el contexto deriva el mismo (`forPlan`): hay un paso vigente `failed` →
 *   `step_failure`; no hay planes → `initial`; si no, `user_feedback`. El `failedStepId` sale del contexto.
 * - Tope de pasos del plan: `BUDGET.maxSteps` menos los pasos `completed` vigentes (FLUJO 3).
 * - Salida inválida (falla, 0 pasos o más del tope): la repetición la hace el cliente del modelo; si persiste → `invalid`.
 *   Qué significa (`unrecoverable`, `replans_exhausted` o conservar el plan) lo decide `runTask` según el tipo (FLUJO 7).
 * - Servicio caído o desborde: `close` con `unrecoverable`. Se registra `error` solo en `step_failure` (con el paso que
 *   falló); antes de que haya pasos que ejecutar, o mientras se espera la confirmación, no se registra (FLUJO 9).
 *
 * Esta función NUNCA llama a `finish` ni escribe `result`.
 */

import { BUDGET } from "../budget.ts";
import type { Op } from "../ctx/index.ts";
import { ContextOverflowError, renderPlan } from "../render/index.ts";
import { planRenderOptions, planViewOptions } from "./adapters.ts";
import { clipWithin } from "./args.ts";
import type { EngineEnv } from "./env.ts";
import { closeOnFailure, queryModel } from "./failures.ts";
import type { PlanApprovalOutcome } from "./runtime.ts";

export type PlanRequest =
  | { readonly kind: "initial" }
  | { readonly kind: "user_feedback"; readonly feedback: string }
  | { readonly kind: "step_failure" };

export type PlanOutcome =
  | { readonly kind: "planned"; readonly planId: string }
  | { readonly kind: "invalid" }
  | { readonly kind: "close"; readonly stopReason: "unrecoverable" }
  | { readonly kind: "cancelled" };

const CANCELLED: PlanOutcome = { kind: "cancelled" };
const UNRECOVERABLE: PlanOutcome = { kind: "close", stopReason: "unrecoverable" };

export async function generatePlan(env: EngineEnv, request: PlanRequest): Promise<PlanOutcome> {
  const { ctx, runtime } = env;
  if (runtime.cancelled || ctx.isClosed()) return CANCELLED;

  // El paso que falló sale del contexto (Decisión 6): el paso vigente `failed`.
  const failed = request.kind === "step_failure" ? ctx.find("steps", { state: "failed", superseded: false })[0] : undefined;
  if (request.kind === "step_failure" && failed === undefined) throw new Error("generatePlan: 'step_failure' sin un paso vigente 'failed'.");

  const feedback = request.kind === "user_feedback" ? clipWithin(request.feedback, BUDGET.feedbackMax) : null;
  const errorStepId = failed?.id ?? null;

  // ── La vista (puede desbordar por los efectos: cierre sin `error`).
  let text: string;
  try {
    text = renderPlan(ctx.view.forPlan(planViewOptions(feedback)), planRenderOptions()).text;
  } catch (error) {
    if (!(error instanceof ContextOverflowError)) throw error;
    console.error(`[Engine] ${error.message}`);
    return UNRECOVERABLE;
  }

  // ── LLM 1. Qwen ya repite una vez una salida inválida: aquí no se repite.
  const completed = ctx.find("steps", { state: "completed", superseded: false }).length;
  const query = await queryModel(
    () => env.llm.generatePlanFromView({ view: text, trigger: request.kind, maxSteps: BUDGET.maxSteps - completed }, runtime.signal),
    0,
  );
  if (runtime.cancelled || ctx.isClosed()) return CANCELLED;
  if (!query.ok) {
    if (query.failure === "invalid") {
      console.error("[Engine] plan inválido:", query.error);
      return { kind: "invalid" };
    }
    const closure = closeOnFailure(ctx, errorStepId, query.failure, query.error);
    return closure.kind === "cancelled" ? CANCELLED : UNRECOVERABLE;
  }

  // ── Registro: el plan y, en otro `apply`, sus pasos (con el reemplazo de los no completados).
  const planId = ctx.apply({ op: "add", target: "plans", value: { trigger: request.kind, feedback, stepId: errorStepId } }).ids[0];
  const replaced: Op[] = ctx
    .find("steps", { superseded: false })
    .filter((s) => s.state !== "completed")
    .map((s): Op => ({ op: "update", target: s.id, value: { superseded: true } }));
  const added = query.value.steps.map((s): Op => ({
    op: "add",
    target: "steps",
    value: { planId, instruction: s.instruction, route: s.route, expected: s.expected },
  }));
  ctx.apply([...replaced, ...added]);
  return { kind: "planned", planId };
}

/** Espera la confirmación del usuario del plan `planId` (sus pasos vigentes). */
export function confirmPlan(env: EngineEnv, planId: string): Promise<PlanApprovalOutcome> {
  const steps = env.ctx
    .find("steps", { planId, superseded: false })
    .map((s) => ({ id: s.id, instruction: s.instruction ?? "", route: s.route ?? "", expected: s.expected ?? "" }));
  return env.runtime.requestPlanApproval({ planId, steps });
}
