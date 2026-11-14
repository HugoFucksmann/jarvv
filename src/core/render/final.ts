/**
 * Renderizadores de cierre.
 *
 * - `renderFinal` (8.3): el texto que recibe LLM 3 para redactar la respuesta final. Aplica los topes de 8.2
 *   (`options.caps`) con el marcador `…(+N)`. Efectos y posibles efectos comparten una reserva y nunca se recortan: si no
 *   entran lanza `ContextOverflowError` y el cierre cae a `renderFallback`.
 * - `renderFallback`: respuesta de respaldo sin modelo, texto para el usuario (en español, no es un prompt). Nunca falla:
 *   los efectos se muestran completos, sin reserva ni tope.
 */

import type { CallView, FallbackView, FinalView } from "../ctx/index.ts";
import { FALLBACK_STATE_TEXT, FALLBACK_STOP_TEXT } from "./messages.ts";
import {
  clipMarked,
  effectEntries,
  evidenceEntry,
  factLine,
  finalStepLine,
  joinSections,
  obsBlock,
  oneLine,
  readEntry,
  stateBlock,
  userBlock,
} from "./shared.ts";
import type { Rendered, ViewCaps } from "./shared.ts";

export interface FinalRenderOptions {
  readonly caps: ViewCaps;
}

export function renderFinal(view: FinalView, options: FinalRenderOptions): Rendered {
  const caps = options.caps;

  const { effects, possible } = effectEntries(view, caps, "forFinal");

  const sections = [
    `REQUEST: ${clipMarked(oneLine(view.request), caps.request)}`,
    `TASK: ${clipMarked(oneLine(view.task.note), caps.finalNote)}`,
    obsBlock("STEPS", view.steps.map((s) => finalStepLine(s, caps))),
    obsBlock("DATA", view.lastReads.map((c) => readEntry(c, caps))),
    obsBlock("EVIDENCE", view.evidence.map((c) => evidenceEntry(c, caps))),
    userBlock(view.userInput, caps),
    stateBlock(view.env, caps),
    // Sin cambios, una línea explícita: si no, el modelo de la respuesta final no tiene con qué descartar que "guardó" o "abrió" algo.
    effects.length === 0 ? "EFFECTS: none — no call changed anything on the computer." : obsBlock("EFFECTS", effects),
    obsBlock("POSSIBLE EFFECTS", possible),
  ];

  const text = joinSections(sections);
  return { text, chars: text.length, overflow: false };
}

/** Llamada para el usuario: id, ruta, herramienta y resultado; sin las frases fijas (que son para los modelos). */
function plainCall(call: CallView, withDetail: boolean): string {
  const parts = [`${call.id} ${oneLine(call.route)}/${oneLine(call.tool)} ${call.status}`];
  if (call.verdict !== null) parts.push(`(${call.verdict})`);
  if (withDetail && call.args !== null) parts.push(`args=${oneLine(JSON.stringify(call.args))}`);
  if (withDetail && call.summary !== null) parts.push(`| ${oneLine(call.summary)}`);
  return `- ${parts.join(" ")}`;
}

/**
 * Encabezado fijo (sin modelo, para el usuario) de una respuesta final cuando la tarea no se completó: el estado, qué no se logró y
 * qué se cambió en la computadora. Lo escribe el código porque el modelo de la respuesta final, con la solicitud a la vista,
 * tendía a contar como hecho lo que se pidió ("aquí tienes el archivo generado") aunque los datos dijeran lo contrario.
 * `null` si la tarea se completó.
 */
export function renderStatusNote(view: FallbackView, notAchieved: readonly string[]): string | null {
  const task = view.task;
  if (task.state !== "partial" && task.state !== "failed") return null;
  const lines = [`⚠ ${FALLBACK_STATE_TEXT[task.state]}${task.stopReason === null ? "" : ` ${FALLBACK_STOP_TEXT[task.stopReason]}`}`];
  if (notAchieved.length > 0) lines.push(`No se logró: ${notAchieved.map((i) => oneLine(i)).join("; ")}.`);
  lines.push(
    view.effects.length === 0
      ? "Cambios realizados en la computadora: ninguno."
      : `Cambios realizados en la computadora:\n${view.effects.map((c) => plainCall(c, false)).join("\n")}`,
  );
  return lines.join("\n");
}

/**
 * Aviso fijo (sin modelo) de lo que quedó escrito en un lugar que la sonda de ubicación rechazó (`wrong_place`): el archivo o la carpeta existe en el disco y el usuario
 * debe saberlo, aunque un reintento haya escrito bien después. El código no sabe cuál era el lugar pedido (sin palabras clave), así que cita el pedido tal cual, no mueve
 * ni borra nada. Una ruta que una llamada aprobada también escribió no cuenta. `null` si no hay ninguna.
 */
export function renderPlaceNote(view: FallbackView, request: string): string | null {
  const pathOf = (c: CallView): string | null => {
    const value = c.tool === "move_file" ? c.args?.destination : c.args?.path;
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };
  const approved = new Set(view.effects.filter((c) => c.verdict === "approved").map(pathOf));
  const wrong = [...new Set(view.effects.filter((c) => c.reason === "wrong_place" && c.verdict === "rejected").map(pathOf))].filter((p): p is string => p !== null && !approved.has(p));
  if (wrong.length === 0) return null;
  return [
    `⚠ ${wrong.length === 1 ? "Quedó escrito en" : "Quedaron escritos en"}: ${wrong.map((p) => oneLine(p)).join("; ")}`,
    `${wrong.length === 1 ? "Ese lugar no coincide" : "Esos lugares no coinciden"} con el que pediste («${oneLine(request)}»). No lo moví ni lo borré: decime si lo muevo o lo elimino.`,
  ].join("\n");
}

export function renderFallback(view: FallbackView): Rendered {
  const task = view.task;
  const sections = [
    FALLBACK_STATE_TEXT[task.state],
    task.stopReason === null ? null : FALLBACK_STOP_TEXT[task.stopReason],
    view.effects.length === 0 ? null : `Cambios realizados:\n${view.effects.map((c) => plainCall(c, true)).join("\n")}`,
    view.possibleEffects.length === 0
      ? null
      : `Posibles cambios (la operación se interrumpió o falló y pudo dejar cambios parciales):\n${view.possibleEffects.map((c) => plainCall(c, true)).join("\n")}`,
    view.env.length === 0 ? null : `Estado del entorno:\n${view.env.map((f) => `- ${factLine(f)}`).join("\n")}`,
    view.lastActions.length === 0 ? null : `Últimas acciones:\n${view.lastActions.map((c) => plainCall(c, false)).join("\n")}`,
  ];
  const text = joinSections(sections);
  return { text, chars: text.length, overflow: false };
}