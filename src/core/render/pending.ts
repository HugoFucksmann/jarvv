/**
 * Renderizador de `forPending` (8.3): el texto que recibe la consulta que mantiene la lista de pendientes del reactivo.
 * Aplica los topes de 8.2 (`options.caps`) con el marcador `…(+N)`. La vista no muestra efectos: nunca desborda.
 *
 * Secciones: REQUEST, PENDING (la lista anterior), STATE, USER, DONE (llamadas hechas con `args` y resumen) y FAIL (últimos
 * intentos no aprobados).
 */

import type { PendingView } from "../ctx/index.ts";
import { callLine, clipMarked, factLine, failureLine, lastCapped, newestWithin, obsBlock, oneLine, userInputLine } from "./shared.ts";
import type { ViewCaps } from "./shared.ts";

export interface PendingRenderOptions {
  readonly caps: ViewCaps;
}

export function renderPending(view: PendingView, options: PendingRenderOptions): string {
  const caps = options.caps;
  const previous = view.previous.map((item, i) => `${i + 1}. ${clipMarked(oneLine(item), caps.step)}`);

  const sections = [
    `REQUEST: ${clipMarked(oneLine(view.request), caps.request)}`,
    previous.length === 0 ? null : `PENDING:\n${previous.join("\n")}`,
    obsBlock("STATE", newestWithin(view.env.map(factLine), caps.env)),
    obsBlock("USER", newestWithin(view.userInput.map(userInputLine), caps.userInput)),
    obsBlock("DONE", lastCapped(view.done.map((c) => callLine(c, caps.pendingEntry)), caps.done)),
    obsBlock("FAIL", view.attempts.map((c) => failureLine(c, caps))),
  ];
  return sections.filter((s): s is string => s !== null).join("\n\n");
}
