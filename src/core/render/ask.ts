/**
 * Renderizador de `forAsk` (8.3): el texto que recibe LLM 4 para redactar la pregunta de `ask_user`. Aplica los topes de
 * 8.2 (`options.caps`) con el marcador `…(+N)`. La vista no muestra efectos: nunca desborda.
 *
 * Secciones: GOAL (reactivo) o TASK y EXPECTED (deliberativo), USER, REJECTED (última llamada no aprobada) y DATA (última
 * lectura con datos).
 */

import type { AskView } from "../ctx/index.ts";
import { callHead, clipMarked, newestWithin, obsBlock, oneLine, readEntry, refText, userInputLine } from "./shared.ts";
import type { ViewCaps } from "./shared.ts";

export interface AskRenderOptions {
  readonly caps: ViewCaps;
}

export function renderAsk(view: AskView, options: AskRenderOptions): string {
  const caps = options.caps;
  const half = Math.floor(caps.step / 2);
  const step = view.step;

  const rejected = view.rejectedCall;
  const rejectedLines: string[] = [];
  if (rejected !== null) {
    const parts = [clipMarked(callHead(rejected), caps.line)];
    if (rejected.args !== null) parts.push(`args=${clipMarked(oneLine(JSON.stringify(rejected.args)), caps.evaluatedArgs)}`);
    if (rejected.summary !== null) parts.push(`| ${clipMarked(oneLine(rejected.summary), caps.rejectedSummary)}`);
    if (rejected.ref !== null) parts.push(clipMarked(refText(rejected.ref), caps.refMark));
    rejectedLines.push(parts.join(" "));
  }

  const sections = [
    view.request === null ? null : `GOAL: ${clipMarked(oneLine(view.request), caps.request)}`,
    step?.instruction == null ? null : `TASK: ${clipMarked(oneLine(step.instruction), half)}`,
    step?.expected == null ? null : `EXPECTED: ${clipMarked(oneLine(step.expected), half)}`,
    obsBlock("USER", newestWithin(view.userInput.map(userInputLine), caps.userInput)),
    obsBlock("REJECTED", rejectedLines),
    obsBlock("DATA", view.lastRead === null ? [] : [readEntry(view.lastRead, caps)]),
  ];
  return sections.filter((s): s is string => s !== null).join("\n\n");
}