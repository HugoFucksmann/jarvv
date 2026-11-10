/**
 * Renderizador de `forArgs` (8.3). Aplica los topes por sección y por elemento de 8.2 (`options.caps`); todo recorte lleva
 * el marcador `…(+N)`. Los efectos no se recortan: si no caben en la reserva (`effectsReserve`) no lanza, devuelve
 * `overflow = true` y quien ejecuta cierra la tarea.
 *
 * Secciones: STATE (hechos de entorno), USER, STEPS (deliberativo) o DONE (reactivo), REFS, DATA, EFFECTS, FAIL, LAST ERROR y TASK
 * (la instrucción del paso, al final).
 *
 * Una llamada con su resultado completo aparece una sola vez y solo las `DETAILED_ATTEMPTS` últimas llevan resultado:
 * - EFFECTS: las últimas llevan el resultado entero; las anteriores, y la que ya está en LAST ERROR, quedan en una línea (llamada y argumentos). Ningún efecto se
 *   omite ni se recorta por cantidad: solo se les saca el texto del resultado.
 * - FAIL: los intentos con la misma herramienta, estado y argumentos se juntan en una línea (`×N`); solo los últimos llevan el resultado.
 * El prompt de una tarea con reintentos pasaba de unos 440 a unos 1200 tokens por repetir el mismo error en EFFECTS y en LAST ERROR (traza del 2026-11-09).
 */

import type { ArgsView, CallView } from "../ctx/index.ts";
import {
  argsText,
  availableRefLine,
  callHead,
  clipMarked,
  effectEntry,
  failureLine,
  joinSections,
  lastCapped,
  multiLine,
  obsBlock,
  oneLine,
  readEntry,
  stateBlock,
  stepDoneLine,
  userBlock,
} from "./shared.ts";
import type { Rendered, ViewCaps } from "./shared.ts";

export interface ArgsRenderOptions {
  readonly caps: ViewCaps;
}

/** Cuántos intentos (los últimos) conservan el texto de su resultado en EFFECTS y FAIL. */
const DETAILED_ATTEMPTS = 2;

/** Llamada en una línea, sin el resultado: el encabezado y los argumentos (con su tope). */
function bareCallLine(call: CallView, caps: ViewCaps, note?: string): string {
  const parts = [clipMarked(callHead(call), caps.line)];
  if (call.args !== null) parts.push(`args=${argsText(call.args, caps.failureArgs)}`);
  if (note !== undefined) parts.push(note);
  return parts.join(" ");
}

/** Efectos: los últimos con su resultado; los anteriores y el que ya figura en LAST ERROR, sin él. */
function effectLines(effects: readonly CallView[], lastErrorId: string | null, caps: ViewCaps): string[] {
  return effects.map((c, i) => {
    if (c.id === lastErrorId) return bareCallLine(c, caps, "| result: see LAST ERROR");
    return i >= effects.length - DETAILED_ATTEMPTS ? effectEntry(c) : bareCallLine(c, caps);
  });
}

/** Fallos: los iguales (misma herramienta, estado y argumentos) en una línea con `×N`; solo los últimos llevan el resultado. */
function failureLines(failures: readonly CallView[], caps: ViewCaps): string[] {
  const key = (c: CallView): string => `${c.tool}|${c.status}|${JSON.stringify(c.args)}`;
  const last = new Map<string, number>();
  const count = new Map<string, number>();
  failures.forEach((c, i) => {
    last.set(key(c), i);
    count.set(key(c), (count.get(key(c)) ?? 0) + 1);
  });
  const kept = failures.filter((c, i) => last.get(key(c)) === i);
  return kept.map((c, i) => {
    const n = count.get(key(c)) ?? 1;
    const times = n > 1 ? ` ×${n} (same arguments)` : "";
    return i >= kept.length - DETAILED_ATTEMPTS ? `${failureLine(c, caps)}${times}` : bareCallLine(c, caps, times.trim() || undefined);
  });
}

/** Último intento fallido de la herramienta: `L`, los argumentos que se probaron y lo que devolvió (en líneas, para conservar el mensaje de error). */
function lastErrorEntry(call: CallView, caps: ViewCaps): string {
  const lines = [clipMarked(callHead(call), caps.line)];
  if (call.args !== null) lines.push(`args=${argsText(call.args, caps.failureArgs)}`);
  if (call.summary !== null) lines.push(clipMarked(multiLine(call.summary), caps.lastErrorSummary));
  return lines.join("\n");
}

export function renderArgs(view: ArgsView, options: ArgsRenderOptions): Rendered {
  const caps = options.caps;

  // Los efectos van enteros: miden contra la reserva y, si no entran, la vista falla en voz alta.
  const effects = effectLines(view.effects, view.lastError?.id ?? null, caps);
  const effectsChars = effects.join("\n").length;

  // La tarea es la instrucción del paso.
  const taskText = view.step?.instruction;
  const task = taskText === null || taskText === undefined ? null : `TASK: ${clipMarked(oneLine(taskText), caps.step)}`;

  const sections = [
    stateBlock(view.env, caps),
    userBlock(view.userInput, caps),
    obsBlock("STEPS", lastCapped(view.stepsDone.map((s) => stepDoneLine(s, caps)), caps.stepsDone)),
    obsBlock("DONE", lastCapped(view.done.map((c) => clipMarked(callHead(c), caps.line)), caps.done)),
    obsBlock("REFS", view.refs.map((r) => clipMarked(availableRefLine(r), caps.refLine))),
    obsBlock("DATA", view.lastReads.map((c) => readEntry(c, caps))),
    obsBlock("EFFECTS", effects),
    obsBlock("FAIL", failureLines(view.stepFailures, caps)),
    obsBlock("LAST ERROR", view.lastError === null ? [] : [lastErrorEntry(view.lastError, caps)]),
    task,
  ];

  const text = joinSections(sections);
  return { text, chars: text.length, overflow: effectsChars > caps.effectsReserve };
}