/**
 * Renderizadores de cierre.
 *
 * - `renderFinal`: bloques para el modelo que redacta la respuesta. Efectos y posibles efectos sin recorte; si
 *   lo irrecortable (solicitud, estado, efectos) excede `maxChars` lanza `ContextOverflowError` y el cierre cae a
 *   `renderFallback`. Lo demás (pasos, evidencia, hechos) se recorta por prioridad, de lo más antiguo a lo reciente.
 * - `renderFallback`: respuesta de respaldo sin modelo, texto para el usuario. Nunca falla: los efectos se muestran
 *   completos aunque el resultado exceda `maxChars`.
 */

import type { FallbackView, FinalView } from "../ctx/index.ts";
import { ContextOverflowError } from "./errors.ts";
import { bareSection, fitSections, listSection, obsSection, plainSection } from "./fit.ts";
import type { Rendered } from "./fit.ts";
import { STATE_NOTES, STOP_REASON_NOTES } from "./messages.ts";
import { callEntry, callLine, clipMarked, factLine, oneLine, stepLine } from "./shared.ts";

export interface FinalRenderOptions {
  readonly maxChars: number;
  readonly lineChars: number;
  readonly requestChars: number;
}

export function renderFinal(view: FinalView, options: FinalRenderOptions): Rendered {
  const rendered = fitSections(
    [
      plainSection("GOAL", clipMarked(oneLine(view.request), options.requestChars), 1),
      plainSection("ESTADO DE LA TAREA", view.state, 0),
      plainSection("MOTIVO DE DETENCIÓN", view.stopReason === null ? null : STOP_REASON_NOTES[view.stopReason], 0),
      obsSection("PASOS", view.steps.map((s) => stepLine(s, options.lineChars)), 3, true),
      obsSection("EVID", view.evidence.map(callEntry), 2, true),
      obsSection("EFFECTS", view.effects.map((c) => callLine(c, null)), 0, false),
      obsSection("POSIBLES EFECTOS", view.possibleEffects.map((c) => callLine(c, null)), 0, false),
      obsSection("FACTS", view.facts.map(factLine), 4, true),
    ],
    options.maxChars,
  );
  if (rendered.overflow) throw new ContextOverflowError("forFinal", options.maxChars, rendered.chars);
  return rendered;
}

export interface FallbackRenderOptions {
  readonly maxChars: number;
  readonly lineChars: number;
}

export function renderFallback(view: FallbackView, options: FallbackRenderOptions): Rendered {
  const dash = (line: string): string => `- ${line}`;
  return fitSections(
    [
      bareSection([STATE_NOTES[view.state]], 0),
      bareSection(view.stopReason === null ? [] : [STOP_REASON_NOTES[view.stopReason]], 0),
      listSection("Cambios realizados", view.effects.map((c) => dash(callLine(c, null))), 0, false),
      listSection(
        "Posibles cambios (la operación se interrumpió o falló y pudo dejar cambios parciales)",
        view.possibleEffects.map((c) => dash(callLine(c, null))),
        0,
        false,
      ),
      listSection("Datos registrados", view.facts.map((f) => dash(factLine(f))), 4, true),
      listSection("Últimos fallos", view.failures.map((c) => dash(callLine(c, options.lineChars))), 3, true),
      listSection("Últimas acciones", view.lastActions.map((c) => dash(callLine(c, options.lineChars))), 5, true),
    ],
    options.maxChars,
  );
}