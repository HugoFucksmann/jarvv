/**
 * Renderizador de `forVerify`: paso, criterio, llamada evaluada (resumen y ref) y efectos del paso.
 * Todo es irrecortable salvo la propia estructura; si excede `maxChars` devuelve `overflow = true`.
 */

import type { VerifyView } from "../ctx/index.ts";
import { fitSections, obsSection, plainSection } from "./fit.ts";
import type { Rendered } from "./fit.ts";
import { callEntry, callLine, clipMarked, oneLine } from "./shared.ts";

export interface VerifyRenderOptions {
  readonly maxChars: number;
  readonly lineChars: number;
  readonly requestChars: number;
}

export function renderVerify(view: VerifyView, options: VerifyRenderOptions): Rendered {
  const fit = (text: string): string => clipMarked(oneLine(text), options.requestChars);
  return fitSections(
    [
      plainSection("GOAL", view.request === null ? null : fit(view.request), 1),
      plainSection("TASK", view.step.instruction === null ? null : fit(view.step.instruction), 0),
      plainSection("EXPECTED", view.step.expected === null ? null : fit(view.step.expected), 0),
      obsSection("RESULTADO DE LA LLAMADA", [callEntry(view.call)], 0, false),
      obsSection("EFFECTS", view.stepEffects.map((c) => callLine(c, null)), 0, false),
    ],
    options.maxChars,
  );
}