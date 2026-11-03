/**
 * `forPlan` (sección 8.3): planificador y replan (LLM 1). El motivo del plan se deriva del contexto: un paso vigente
 * `failed` es `step_failure`; sin planes es `initial`; con planes y sin paso fallido es `user_feedback`, que trae su
 * `feedback` como parámetro porque el plan en curso todavía no está en el contexto.
 *
 * Una llamada aparece una sola vez: efectos y posibles efectos > `failures`.
 */

import { effectsOf, possibleEffectsOf, recentFailures, recentWindowSize } from "../derive.ts";
import { ContextError } from "../errors.ts";
import type { ContextData, Step } from "../types.ts";
import {
  callViewOf,
  effectViewsOf,
  envViewsOf,
  possibleEffectViewsOf,
  stepsDoneViews,
  stepViewOf,
  userInputViewsOf,
} from "./shared.ts";
import type { FeedbackView, PlanTriggerView, PlanView, PlanViewOptions } from "./types.ts";

export function buildPlanView(data: ContextData, options: PlanViewOptions): PlanView {
  const vigentes = data.steps.filter((s) => !s.superseded);
  const failed = [...vigentes].reverse().find((s) => s.state === "failed");

  let trigger: PlanTriggerView;
  if (failed !== undefined) {
    trigger = { kind: "step_failure", failedStepId: failed.id };
  } else if (data.plans.length === 0) {
    trigger = { kind: "initial" };
  } else {
    if (options.feedback === null) throw new ContextError("invalid_value", null, "forPlan: el plan `user_feedback` exige el `feedback` como parámetro");
    trigger = { kind: "user_feedback", feedback: options.feedback };
  }

  const pending = vigentes.filter((s) => s.state === "pending");
  const running = vigentes.find((s) => s.state === "running");
  // Actual: el fallido (replan), el que corre o, con el plan propuesto todavía sin ejecutar, el primero pendiente.
  const current: Step | undefined = failed ?? running ?? pending[0];
  const next = pending.filter((s) => s.id !== current?.id);

  const hidden = new Set<string>([...effectsOf(data.calls), ...possibleEffectsOf(data.calls)].map((c) => c.id));
  const done = stepsDoneViews(data, hidden);

  const size = recentWindowSize(data.steps, options.recentWindows);
  const failures =
    failed === undefined ? [] : recentFailures(data.calls, size, failed.id).filter((c) => !hidden.has(c.id));

  const feedbacks: FeedbackView[] = [];
  for (const plan of data.plans) {
    if (plan.feedback !== null) feedbacks.push({ planId: plan.id, feedback: plan.feedback });
  }

  return {
    request: data.task.request,
    trigger,
    previousFeedback: options.previousFeedback <= 0 ? [] : feedbacks.slice(-options.previousFeedback),
    steps: {
      done: options.stepsDone <= 0 ? [] : done.slice(-options.stepsDone),
      current: current === undefined ? null : stepViewOf(current),
      next: next.map(stepViewOf),
    },
    failures: failures.map((c) => callViewOf(data, c, true)),
    userInput: userInputViewsOf(data),
    env: envViewsOf(data),
    effects: effectViewsOf(data),
    possibleEffects: possibleEffectViewsOf(data),
  };
}