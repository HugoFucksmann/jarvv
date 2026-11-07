/**
 * Renderizador de `forArgs` (8.3). Aplica los topes por sección y por elemento de 8.2 (`options.caps`); todo recorte lleva
 * el marcador `…(+N)`. Los efectos no se recortan: si no caben en la reserva (`effectsReserve`) no lanza, devuelve
 * `overflow = true` y quien ejecuta cierra la tarea.
 *
 * Secciones: STATE (hechos de entorno), USER, STEPS (deliberativo) o DONE (reactivo), REFS, DATA, EFFECTS, FAIL y TASK
 * (la instrucción del paso, al final).
 */

import type { ArgsView } from "../ctx/index.ts";
import {
  availableRefLine,
  callHead,
  callLine,
  clipMarked,
  factLine,
  failureLine,
  lastCapped,
  newestWithin,
  obsBlock,
  oneLine,
  readEntry,
  stepDoneLine,
  userInputLine,
} from "./shared.ts";
import type { Rendered, ViewCaps } from "./shared.ts";

export interface ArgsRenderOptions {
  readonly caps: ViewCaps;
}

export function renderArgs(view: ArgsView, options: ArgsRenderOptions): Rendered {
  const caps = options.caps;

  // Los efectos van enteros: miden contra la reserva y, si no entran, la vista falla en voz alta.
  const effects = view.effects.map((c) => callLine(c, null));
  const effectsChars = effects.join("\n").length;

  // La tarea es la instrucción del paso.
  const taskText = view.step?.instruction;
  const task = taskText === null || taskText === undefined ? null : `TASK: ${clipMarked(oneLine(taskText), caps.step)}`;

  const sections = [
    obsBlock("STATE", newestWithin(view.env.map(factLine), caps.env)),
    obsBlock("USER", newestWithin(view.userInput.map(userInputLine), caps.userInput)),
    obsBlock("STEPS", lastCapped(view.stepsDone.map((s) => stepDoneLine(s, caps)), caps.stepsDone)),
    obsBlock("DONE", lastCapped(view.done.map((c) => clipMarked(callHead(c), caps.line)), caps.done)),
    obsBlock("REFS", view.refs.map((r) => clipMarked(availableRefLine(r), caps.refLine))),
    obsBlock("DATA", view.lastReads.map((c) => readEntry(c, caps))),
    obsBlock("EFFECTS", effects),
    obsBlock("FAIL", view.stepFailures.map((c) => failureLine(c, caps))),
    task,
  ];

  const text = sections.filter((s): s is string => s !== null).join("\n\n");
  return { text, chars: text.length, overflow: effectsChars > caps.effectsReserve };
}