/**
 * Renderizador de `forRoute`. Si lo irrecortable excede `maxChars` no lanza: devuelve `overflow = true` y quien
 * ejecuta decide (solo `forPlan` y `forFinal` fallan en voz alta).
 */

import type { RouteView } from "../ctx/index.ts";
import { fitSections, obsSection, plainSection } from "./fit.ts";
import type { Rendered } from "./fit.ts";
import { attemptLine, callLine, clipMarked, factLine, oneLine } from "./shared.ts";

export interface RouteRenderOptions {
  readonly maxChars: number;
  readonly lineChars: number;
  readonly requestChars: number;
}

export function renderRoute(view: RouteView, options: RouteRenderOptions): Rendered {
  const fit = (text: string): string => clipMarked(oneLine(text), options.lineChars);
  const step = view.step;
  return fitSections(
    [
      plainSection("GOAL", view.request === null ? null : clipMarked(oneLine(view.request), options.requestChars), 1),
      plainSection("PASO ACTUAL", step === null ? null : `${step.id} [${step.state}]`, 0),
      plainSection("TASK", step?.instruction == null ? null : fit(step.instruction), 0),
      plainSection("EXPECTED", step?.expected == null ? null : fit(step.expected), 0),
      obsSection("FACTS", view.facts.map(factLine), 4, true),
      obsSection("LOG", view.attempts.map(attemptLine), 5, true),
      obsSection("FAIL", view.failures.map((c) => callLine(c, options.lineChars)), 3, true),
    ],
    options.maxChars,
  );
}