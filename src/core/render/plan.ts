/**
 * Renderizador de `forPlan`. Los efectos y posibles efectos no se recortan: si lo irrecortable no entra en `maxChars`
 * (el límite del modelo, que pasa el llamador) lanza `ContextOverflowError`.
 */

import type { PlanView } from "../ctx/index.ts";
import { ContextOverflowError } from "./errors.ts";
import { fitSections, obsSection, plainSection } from "./fit.ts";
import type { Rendered } from "./fit.ts";
import { callLine, clipMarked, factLine, oneLine, stepLine } from "./shared.ts";

export interface PlanRenderOptions {
  readonly maxChars: number;
  readonly lineChars: number;
  readonly requestChars: number;
  readonly feedbackChars: number;
}

export function renderPlan(view: PlanView, options: PlanRenderOptions): Rendered {
  const steps: string[] = [];
  if (view.steps.omittedBefore > 0) steps.push(`[… ${view.steps.omittedBefore} pasos anteriores omitidos]`);
  for (const s of view.steps.before) steps.push(stepLine(s, options.lineChars));
  if (view.steps.current !== null) steps.push(stepLine(view.steps.current, options.lineChars));
  for (const s of view.steps.after) steps.push(stepLine(s, options.lineChars));
  if (view.steps.omittedAfter > 0) steps.push(`[… ${view.steps.omittedAfter} pasos siguientes omitidos]`);

  const rendered = fitSections(
    [
      plainSection("GOAL", clipMarked(oneLine(view.request), options.requestChars), 1),
      obsSection("PASOS", steps, 0, false),
      obsSection(
        "FEEDBACK",
        view.feedbacks.map((f) => `${f.planId}: ${clipMarked(oneLine(f.feedback), options.feedbackChars)}`),
        2,
        false,
      ),
      obsSection("FACTS", view.facts.map(factLine), 4, true),
      obsSection("EFFECTS", view.effects.map((c) => callLine(c, null)), 0, false),
      obsSection("POSIBLES EFECTOS", view.possibleEffects.map((c) => callLine(c, null)), 0, false),
      obsSection("FAIL", view.failures.map((c) => callLine(c, options.lineChars)), 3, true),
    ],
    options.maxChars,
  );
  if (rendered.overflow) throw new ContextOverflowError("forPlan", options.maxChars, rendered.chars);
  return rendered;
}
