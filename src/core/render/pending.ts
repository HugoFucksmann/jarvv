/**
 * Renderizador de `forPending` (8.3): el texto que recibe la consulta que mantiene la lista de pendientes del reactivo.
 * Aplica los topes de 8.2 (`options.caps`) con el marcador `…(+N)`. La vista no muestra efectos: nunca desborda.
 *
 * Secciones: REQUEST, PENDING (la lista anterior), STATE, USER, DONE (llamadas hechas con `args` y resumen) y FAIL (últimos
 * intentos no aprobados).
 */

import type { PendingView } from "../ctx/index.ts";
import { callLine, clipMarked, failureLine, joinSections, lastCapped, obsBlock, oneLine, stateBlock, userBlock } from "./shared.ts";
import type { ViewCaps } from "./shared.ts";

export interface PendingRenderOptions {
  readonly caps: ViewCaps;
}

/**
 * Encabezados con los que los prompts de `pending`, de Decisión 5 y de `recovery` muestran las secciones de `renderPending`. Las claves son los encabezados que emite
 * `renderPending` (`PENDING:`, `DONE:`, `FAIL:`, `USER:`); si se cambia uno allí, hay que cambiarlo acá: `tests/render.test.ts` lo comprueba.
 */
export const PENDING_PROMPT_TITLES = {
  PENDING: "### PREVIOUS TO-DO LIST (PENDING):",
  DONE: "### COMPLETED TASKS (DONE):",
  FAIL: "### FAILED TASKS (REPLACE IN PENDING):",
  USER: "### USER INSTRUCTIONS (FOLLOW):",
} as const;

/** El texto de `renderPending` con los encabezados de los prompts (`PENDING_PROMPT_TITLES`). Solo cambia la primera línea de cada sección. */
export function retitlePending(rendered: string): string {
  let out = rendered.trim();
  for (const [label, title] of Object.entries(PENDING_PROMPT_TITLES)) {
    out = out.replace(new RegExp(`^${label}:\\n`, "m"), `${title}\n`);
  }
  return out;
}

export function renderPending(view: PendingView, options: PendingRenderOptions): string {
  const caps = options.caps;
  const previous = view.previous.map((item, i) => `${i + 1}. ${clipMarked(oneLine(item), caps.step)}`);

  const sections = [
    `REQUEST: ${clipMarked(oneLine(view.request), caps.request)}`,
    previous.length === 0 ? null : `PENDING:\n${previous.join("\n")}`,
    stateBlock(view.env, caps),
    userBlock(view.userInput, caps),
    obsBlock("DONE", lastCapped(view.done.map((c) => callLine(c, caps.pendingEntry)), caps.done)),
    obsBlock("FAIL", view.attempts.map((c) => failureLine(c, caps))),
  ];
  return joinSections(sections);
}
