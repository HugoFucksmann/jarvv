/**
 * `forPlan` (sección 8): planificador y replan. Solicitud, ventana de pasos (ya ejecutados, actual, siguientes),
 * todos los efectos sin recorte y los posibles efectos, hechos, fallos recientes y `feedback` de los planes anteriores.
 * La ventana de pasos no depende de las escalaciones; la de fallos sí (9).
 */

import { lastN, recentFailures, recentWindowSize } from "../derive.ts";
import type { ContextData } from "../types.ts";
import {
  effectViewsOf,
  factViewsOf,
  failureViewOf,
  possibleEffectViewsOf,
  stepViewOf,
} from "./shared.ts";
import type { FeedbackView, PlanView, PlanViewOptions } from "./types.ts";

export function buildPlanView(data: ContextData, options: PlanViewOptions): PlanView {
  const size = recentWindowSize(data.steps, options.recentWindows);
  const vigentes = data.steps.filter((s) => !s.superseded);
  const executed = vigentes.filter((s) => s.state === "completed" || s.state === "failed");
  const pending = vigentes.filter((s) => s.state === "pending");
  const running = vigentes.find((s) => s.state === "running");

  const before = lastN(executed, options.planStepsBefore);
  const after = pending.slice(0, Math.max(0, options.planStepsAfter));

  const feedbacks: FeedbackView[] = [];
  for (const plan of data.plans) {
    if (plan.feedback !== null) feedbacks.push({ planId: plan.id, feedback: plan.feedback });
  }

  return {
    mode: data.task.mode,
    request: data.task.request,
    steps: {
      before: before.map(stepViewOf),
      omittedBefore: executed.length - before.length,
      current: running === undefined ? null : stepViewOf(running),
      after: after.map(stepViewOf),
      omittedAfter: pending.length - after.length,
    },
    effects: effectViewsOf(data),
    possibleEffects: possibleEffectViewsOf(data),
    facts: factViewsOf(data),
    failures: recentFailures(data.calls, size).map((c) => failureViewOf(data, c)),
    feedbacks,
  };
}
