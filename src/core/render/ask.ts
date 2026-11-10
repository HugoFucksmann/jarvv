/**
 * Renderizador de `forAsk` (8.3): el texto que recibe LLM 4 para redactar la pregunta de `ask_user`. Aplica los topes de
 * 8.2 (`options.caps`) con el marcador `…(+N)`. La vista no muestra efectos: nunca desborda.
 *
 * Secciones: GOAL (reactivo) o TASK y EXPECTED (deliberativo), USER, REJECTED (última llamada no aprobada) y DATA (última
 * lectura con datos).
 */

import type { AskView } from "../ctx/index.ts";
import { clipMarked, failureLine, joinSections, obsBlock, oneLine, readEntry, userBlock } from "./shared.ts";
import type { ViewCaps } from "./shared.ts";

export interface AskRenderOptions {
  readonly caps: ViewCaps;
}

export function renderAsk(view: AskView, options: AskRenderOptions): string {
  const caps = options.caps;
  const half = Math.floor(caps.step / 2);
  const step = view.step;

  // La llamada rechazada es una línea de fallo con topes propios: los argumentos se ven casi enteros (son lo que se corrige).
  const rejectedLines = view.rejectedCall === null ? [] : [failureLine(view.rejectedCall, caps, { args: caps.evaluatedArgs, summary: caps.rejectedSummary })];

  const sections = [
    view.request === null ? null : `GOAL: ${clipMarked(oneLine(view.request), caps.request)}`,
    step?.instruction == null ? null : `TASK: ${clipMarked(oneLine(step.instruction), half)}`,
    step?.expected == null ? null : `EXPECTED: ${clipMarked(oneLine(step.expected), half)}`,
    userBlock(view.userInput, caps),
    obsBlock("REJECTED", rejectedLines),
    obsBlock("DATA", view.lastRead === null ? [] : [readEntry(view.lastRead, caps)]),
  ];
  return joinSections(sections);
}