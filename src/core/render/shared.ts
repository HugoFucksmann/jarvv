/**
 * Piezas comunes de los renderizadores. Aquí se sanea todo texto que viene de fuera del contexto (resúmenes,
 * argumentos, rutas, instrucciones del plan) con `text.ts`: neutraliza `<obs>` y las etiquetas de bloque del prompt.
 */

import type { BUDGET } from "../budget.ts";
import type { AvailableRefView, CallView, FactView, RefView, StepDoneView, StepView, UserInputView } from "../ctx/index.ts";
import { sanitizeMultiline, flatten } from "../text.ts";

/** Texto externo en una sola línea, saneado. */
export const oneLine = (text: string): string => flatten(text);

/** Texto externo que conserva los saltos de línea y la sangría, saneado. */
export const multiLine = (text: string): string => sanitizeMultiline(text);

/** Recorte explícito: conserva `max` caracteres y agrega `…(+N)` con los omitidos. */
export function clipMarked(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…(+${text.length - max})`;
}

/**
 * Los elementos más recientes (los últimos de la lista, que viene en orden cronológico) que caben en `maxChars`, sin cortar
 * ninguno (8.1: `userInput` y `env`). Cuenta un salto de línea entre elementos.
 */
export function newestWithin(lines: readonly string[], maxChars: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + (out.length > 0 ? 1 : 0);
    if (used + cost > maxChars) break;
    out.unshift(lines[i]);
    used += cost;
  }
  return out;
}

/**
 * Los últimos `max` elementos (la lista viene en orden cronológico); si se omiten, una primera línea `…(+N)` con la
 * cantidad de anteriores omitidos (tope por sección de 8.2, en elementos).
 */
export function lastCapped(lines: readonly string[], max: number): string[] {
  if (lines.length <= max) return [...lines];
  return [`…(+${lines.length - max})`, ...lines.slice(lines.length - max)];
}

/** Resultado de un renderizador: el texto, su tamaño y si lo que no se puede recortar (efectos) excede su reserva. */
export interface Rendered {
  text: string;
  /** Tamaño del texto en caracteres. */
  chars: number;
  /** Lo que no se puede recortar excede su reserva. */
  overflow: boolean;
}

/** Sección `ETIQUETA:` con sus líneas dentro de un bloque `<obs>…</obs>` (datos externos); `null` si no hay líneas. */
export function obsBlock(label: string, lines: readonly string[]): string | null {
  return lines.length === 0 ? null : `${label}:\n<obs>\n${lines.join("\n")}\n</obs>`;
}

/** `ref:rN (tamaño, ruta)`: lo que el modelo necesita para leer la ref con una lectura normal. */
export function refText(ref: RefView): string {
  return `ref:${ref.id} (${ref.size}, ${oneLine(ref.where)})`;
}

/** Identificación de la llamada y su resultado fijo: sin `args`, resumen ni ref. */
export function callHead(call: CallView): string {
  const parts = [`${call.id} ${call.stepId} ${oneLine(call.route)}/${oneLine(call.tool)} ${call.kind} ${call.status}`];
  if (call.verdict !== null) parts.push(`verdict=${call.verdict}`);
  if (call.statusNote !== null) parts.push(`— ${call.statusNote}`);
  if (call.reasonNote !== null) parts.push(`— ${call.reasonNote}`);
  return parts.join(" ");
}

/**
 * Llamada en una sola línea. `lineChars = null` no recorta (efectos); con un número recorta `args` y `summary` por
 * separado con el marcador `…(+N)`.
 */
export function callLine(call: CallView, lineChars: number | null): string {
  const fit = (text: string): string => (lineChars === null ? text : clipMarked(text, lineChars));
  const parts = [callHead(call)];
  if (call.args !== null) parts.push(`args=${fit(oneLine(JSON.stringify(call.args)))}`);
  if (call.summary !== null) parts.push(`| ${fit(oneLine(call.summary))}`);
  if (call.ref !== null) parts.push(refText(call.ref));
  return parts.join(" ");
}

export function factLine(fact: FactView): string {
  return `${fact.key}=${oneLine(fact.value)}`;
}

/** Entrada del usuario: tipo, paso y texto en una línea. */
export function userInputLine(input: UserInputView): string {
  return `${input.kind} ${input.stepId}: ${oneLine(input.text)}`;
}

/** Ref disponible con lo ya leído de ella: los valores de `offset` y `length` tal como los pidió cada lectura. */
export function availableRefLine(ref: AvailableRefView): string {
  const shown =
    ref.shown.length === 0
      ? "unread"
      : ref.shown.map((r) => `offset=${r.offset ?? "—"} length=${r.length ?? "—"}`).join("; ");
  return `${refText(ref)} ${oneLine(ref.label)} — read: ${shown}`;
}

// ───────────────────────── Elementos de las vistas con topes (8.2) ─────────────────────────

/** Topes por sección y por elemento (`BUDGET.caps`). */
export type ViewCaps = typeof BUDGET.caps;

/** Lectura: `L` + `args` + resumen completo (en líneas) + marca de ref. */
export function readEntry(call: CallView, caps: ViewCaps): string {
  const lines = [clipMarked(callHead(call), caps.line)];
  if (call.args !== null) lines.push(`args=${clipMarked(oneLine(JSON.stringify(call.args)), caps.readArgs)}`);
  if (call.summary !== null) lines.push(clipMarked(multiLine(call.summary), caps.readSummary));
  if (call.ref !== null) lines.push(clipMarked(refText(call.ref), caps.refMark));
  return lines.join("\n");
}

/** Fallo `F`: `L` + `args` (solo donde la vista los trae) + resumen, cada uno con su tope. */
export function failureLine(call: CallView, caps: ViewCaps): string {
  const parts = [clipMarked(callHead(call), caps.line)];
  if (call.args !== null) parts.push(`args=${clipMarked(oneLine(JSON.stringify(call.args)), caps.failureArgs)}`);
  if (call.summary !== null) parts.push(`| ${clipMarked(oneLine(call.summary), caps.failureSummary)}`);
  if (call.ref !== null) parts.push(clipMarked(refText(call.ref), caps.refMark));
  return parts.join(" ");
}

/** Paso completado: id, instrucción (≤ `stepsDoneInstruction`) y resultado (resumen ≤ `stepsDoneOutcome`). */
export function stepDoneLine(step: StepDoneView, caps: ViewCaps): string {
  const parts = [step.id];
  if (step.instruction !== null) parts.push(clipMarked(oneLine(step.instruction), caps.stepsDoneInstruction));
  if (step.outcome !== null) {
    const outcome = step.outcome;
    const result = [`→ ${oneLine(outcome.route)}/${oneLine(outcome.tool)} ${outcome.id}`];
    if (outcome.summary !== null) result.push(clipMarked(oneLine(outcome.summary), caps.stepsDoneOutcome));
    if (outcome.ref !== null) result.push(clipMarked(refText(outcome.ref), caps.refMark));
    parts.push(result.join(" | "));
  }
  return parts.join(" ");
}

/** Paso actual o fallido: id, estado, ruta, instrucción y criterio (entre los dos, el tope `step`). */
export function currentStepLine(step: StepView, caps: ViewCaps): string {
  const half = Math.floor(caps.step / 2);
  const parts = [`${step.id} [${step.state}]`];
  if (step.route !== null) parts.push(`${oneLine(step.route)}:`);
  if (step.instruction !== null) parts.push(clipMarked(oneLine(step.instruction), half));
  if (step.expected !== null) parts.push(`→ expected: ${clipMarked(oneLine(step.expected), half)}`);
  return parts.join(" ");
}

/** Paso siguiente: id, ruta e instrucción (≤ `nextInstruction`). */
export function nextStepLine(step: StepView, caps: ViewCaps): string {
  const parts = [step.id];
  if (step.route !== null) parts.push(`${oneLine(step.route)}:`);
  if (step.instruction !== null) parts.push(clipMarked(oneLine(step.instruction), caps.nextInstruction));
  return parts.join(" ");
}

/** Paso de `forFinal`: id, estado e instrucción (≤ `finalStepInstruction`). */
export function finalStepLine(step: StepView, caps: ViewCaps): string {
  const parts = [`${step.id} [${step.state}]`];
  if (step.instruction !== null) parts.push(clipMarked(oneLine(step.instruction), caps.finalStepInstruction));
  return parts.join(" ");
}

/** Evidencia de `forFinal`: una aprobada lleva `L` + resumen (≤ `evidenceSummary`) + marca de ref; el resto, solo `L`. */
export function evidenceEntry(call: CallView, caps: ViewCaps): string {
  const lines = [clipMarked(callHead(call), caps.line)];
  if (call.summary !== null) lines.push(clipMarked(multiLine(call.summary), caps.evidenceSummary));
  if (call.ref !== null) lines.push(clipMarked(refText(call.ref), caps.refMark));
  return lines.join("\n");
}