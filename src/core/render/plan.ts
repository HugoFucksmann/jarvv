/**
 * Renderizador de `forPlan` (8.3): el texto que recibe LLM 1 para planificar o replanificar. Aplica los topes por sección y
 * por elemento de 8.2 (`options.caps`) con el marcador `…(+N)`. Los efectos y posibles efectos comparten una reserva y nunca
 * se recortan: si no entran lanza `ContextOverflowError` (la tarea cierra con `unrecoverable`).
 *
 * Secciones: REQUEST, TRIGGER, PREVIOUS FEEDBACK, STEPS DONE, CURRENT, NEXT, FAILURES, USER, STATE, EFFECTS y
 * POSSIBLE EFFECTS (las vacías se omiten).
 */

import type { PlanView } from "../ctx/index.ts";
import { ContextOverflowError } from "./errors.ts";
import {
  effectEntry,
  clipMarked,
  currentStepLine,
  factLine,
  failureLine,
  lastCapped,
  newestWithin,
  nextStepLine,
  obsBlock,
  oneLine,
  stepDoneLine,
  userInputLine,
} from "./shared.ts";
import type { Rendered, ViewCaps } from "./shared.ts";

export interface PlanRenderOptions {
  readonly caps: ViewCaps;
  /** Tope del `feedback` (`plans.feedback`, 5.2): el del plan en curso y el de los anteriores. */
  readonly feedbackMax: number;
}

export function renderPlan(view: PlanView, options: PlanRenderOptions): Rendered {
  const { caps, feedbackMax } = options;
  const trigger = view.trigger;

  const triggerText =
    trigger.kind === "initial"
      ? "initial"
      : trigger.kind === "step_failure"
        ? `step_failure (failed step: ${trigger.failedStepId})`
        : `user_feedback\n${obsBlock("FEEDBACK", [clipMarked(oneLine(trigger.feedback), feedbackMax)])}`;

  const effects = view.effects.map(effectEntry);
  const possible = view.possibleEffects.map(effectEntry);
  const effectsChars = [...effects, ...possible].join("\n").length;
  if (effectsChars > caps.effectsReserve) throw new ContextOverflowError("forPlan", caps.effectsReserve, effectsChars);

  const sections = [
    `REQUEST: ${clipMarked(oneLine(view.request), caps.request)}`,
    `TRIGGER: ${triggerText}`,
    obsBlock("PREVIOUS FEEDBACK", view.previousFeedback.map((f) => `${f.planId}: ${clipMarked(oneLine(f.feedback), feedbackMax)}`)),
    obsBlock("STEPS DONE", lastCapped(view.steps.done.map((s) => stepDoneLine(s, caps)), caps.stepsDone)),
    obsBlock("CURRENT", view.steps.current === null ? [] : [currentStepLine(view.steps.current, caps)]),
    obsBlock("NEXT", view.steps.next.map((s) => nextStepLine(s, caps))),
    obsBlock("FAILURES", view.failures.map((c) => failureLine(c, caps))),
    obsBlock("USER", newestWithin(view.userInput.map(userInputLine), caps.userInput)),
    obsBlock("STATE", newestWithin(view.env.map(factLine), caps.env)),
    obsBlock("EFFECTS", effects),
    obsBlock("POSSIBLE EFFECTS", possible),
  ];

  const text = sections.filter((s): s is string => s !== null).join("\n\n");
  return { text, chars: text.length, overflow: false };
}