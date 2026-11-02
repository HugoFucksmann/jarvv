/**
 * Piezas comunes de los renderizadores. Aquí se sanea todo texto que viene de fuera del contexto (resúmenes,
 * argumentos, rutas, instrucciones del plan) con `text.ts`: neutraliza `<obs>` y las etiquetas de bloque del prompt.
 */

import type { AttemptView, AvailableRefView, CallView, FactView, RefView, StepView } from "../ctx/index.ts";
import { sanitizeMultiline, flatten } from "../processor/text.ts";

/** Texto externo en una sola línea, saneado. */
export const oneLine = (text: string): string => flatten(text);

/** Texto externo que conserva los saltos de línea y la sangría, saneado. */
export const multiLine = (text: string): string => sanitizeMultiline(text);

/** Recorte explícito: conserva `max` caracteres y agrega `…(+N)` con los omitidos. */
export function clipMarked(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…(+${text.length - max})`;
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

/** Llamada en varias líneas (cabecera, `args`, resumen con sus saltos de línea, ref): para evidencia y datos. */
export function callEntry(call: CallView): string {
  const lines = [callHead(call)];
  if (call.args !== null) lines.push(`args=${oneLine(JSON.stringify(call.args))}`);
  if (call.summary !== null) lines.push(multiLine(call.summary));
  if (call.ref !== null) lines.push(refText(call.ref));
  return lines.join("\n");
}

export function stepLine(step: StepView, lineChars: number): string {
  const fit = (text: string): string => clipMarked(oneLine(text), lineChars);
  const flags = step.superseded ? `${step.state}, superseded` : step.state;
  const parts = [`${step.id} [${flags}]`];
  if (step.route !== null) parts.push(`${fit(step.route)}:`);
  if (step.instruction !== null) parts.push(fit(step.instruction));
  if (step.expected !== null) parts.push(`→ esperado: ${fit(step.expected)}`);
  return parts.join(" ");
}

export function factLine(fact: FactView): string {
  return `${fact.key}=${oneLine(fact.value)}`;
}

export function attemptLine(attempt: AttemptView): string {
  const verdict = attempt.verdict === null ? "" : ` verdict=${attempt.verdict}`;
  return `${attempt.callId} ${attempt.stepId} ${oneLine(attempt.route)}/${oneLine(attempt.tool)} ${attempt.status}${verdict}${attempt.failed ? " (falló)" : ""}`;
}

/** Ref disponible con lo ya leído de ella: los valores de `offset` y `length` tal como los pidió cada lectura. */
export function availableRefLine(ref: AvailableRefView): string {
  const shown =
    ref.shown.length === 0
      ? "sin leer"
      : ref.shown.map((r) => `offset=${r.offset ?? "—"} length=${r.length ?? "—"}`).join("; ");
  return `${refText(ref)} ${oneLine(ref.label)} — leído: ${shown}`;
}