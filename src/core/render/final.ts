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
import { ContextOverflowError } from "./errors.ts";
import { FALLBACK_STATE_TEXT, FALLBACK_STOP_TEXT } from "./messages.ts";
import {
  callLine,
  clipMarked,
  evidenceEntry,
  factLine,
  finalStepLine,
  newestWithin,
  obsBlock,
  oneLine,
  readEntry,
  userInputLine,
} from "./shared.ts";
import type { Rendered, ViewCaps } from "./shared.ts";

export interface FinalRenderOptions {
  readonly caps: ViewCaps;
}

export function renderFinal(view: FinalView, options: FinalRenderOptions): Rendered {
  const caps = options.caps;

  const effects = view.effects.map((c) => callLine(c, null));
  const possible = view.possibleEffects.map((c) => callLine(c, null));
  const effectsChars = [...effects, ...possible].join("\n").length;
  if (effectsChars > caps.effectsReserve) throw new ContextOverflowError("forFinal", caps.effectsReserve, effectsChars);

  const sections = [
    `REQUEST: ${clipMarked(oneLine(view.request), caps.request)}`,
    `TASK: ${clipMarked(oneLine(view.task.note), caps.finalNote)}`,
    obsBlock("STEPS", view.steps.map((s) => finalStepLine(s, caps))),
    obsBlock("DATA", view.lastReads.map((c) => readEntry(c, caps))),
    obsBlock("EVIDENCE", view.evidence.map((c) => evidenceEntry(c, caps))),
    obsBlock("USER", newestWithin(view.userInput.map(userInputLine), caps.userInput)),
    obsBlock("STATE", newestWithin(view.env.map(factLine), caps.env)),
    obsBlock("EFFECTS", effects),
    obsBlock("POSSIBLE EFFECTS", possible),
  ];

  const text = sections.filter((s): s is string => s !== null).join("\n\n");
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
  const text = sections.filter((s): s is string => s !== null).join("\n\n");
  return { text, chars: text.length, overflow: false };
}