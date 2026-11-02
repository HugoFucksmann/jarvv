/**
 * Renderizador de `forArgs`. Las vistas muestran `ref:rN (tamaño, ruta)`. Efectos y handoff no se recortan; la última
 * lectura con datos se conserva (`keep = 1`) mientras se pueda. Si lo irrecortable excede `maxChars` no lanza:
 * devuelve `overflow = true`.
 */

import type { ArgsView } from "../ctx/index.ts";
import { fitSections, obsSection, plainSection } from "./fit.ts";
import type { Rendered } from "./fit.ts";
import {
  attemptLine,
  availableRefLine,
  callEntry,
  callLine,
  clipMarked,
  factLine,
  multiLine,
  oneLine,
  refText,
} from "./shared.ts";

export interface ArgsRenderOptions {
  readonly maxChars: number;
  readonly lineChars: number;
  readonly requestChars: number;
}

export function renderArgs(view: ArgsView, options: ArgsRenderOptions): Rendered {
  const handoff =
    view.handoff === null
      ? []
      : [
          [`${view.handoff.stepId} ${view.handoff.callId}`, multiLine(view.handoff.summary), ...(view.handoff.ref === null ? [] : [refText(view.handoff.ref)])].join("\n"),
        ];
  // En reactivo la instrucción es la solicitud; en deliberativo, la del paso.
  const task =
    view.step?.instruction != null
      ? clipMarked(oneLine(view.step.instruction), options.requestChars)
      : view.request === null
        ? null
        : clipMarked(oneLine(view.request), options.requestChars);

  return fitSections(
    [
      obsSection("HANDOFF", handoff, 1, false),
      obsSection("REFS", view.refs.map(availableRefLine), 3, true),
      obsSection("DATA", view.lastReads.map(callEntry), 2, true, 1),
      obsSection("EFFECTS", view.effects.map((c) => callLine(c, null)), 0, false),
      obsSection("FACTS", view.facts.map(factLine), 4, true),
      obsSection("LOG", view.history.map(attemptLine), 5, true),
      obsSection("FAIL", view.stepFailures.map((c) => callLine(c, options.lineChars)), 3, true),
      plainSection("TASK", task, 0),
    ],
    options.maxChars,
  );
}
