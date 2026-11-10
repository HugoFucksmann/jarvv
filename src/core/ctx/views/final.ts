/**
 * `forFinal` y `forFallback` (sección 8.3): cierre de la tarea. Ambas muestran todos los efectos y posibles efectos sin
 * recorte. `forFinal` alimenta al modelo que redacta la respuesta; `forFallback`, la respuesta de respaldo sin modelo
 * (también la de `cancelled`).
 *
 * Una llamada aparece una sola vez: efectos y posibles efectos > `lastReads` > `evidence`.
 */

import { isApproved, lastN, lastReadsWithData, recentWindowSize } from "../derive.ts";
import type { ContextData } from "../types.ts";
import {
  callViewOf,
  effectIdsOf,
  effectViewsOf,
  envViewsOf,
  lineViewOf,
  possibleEffectViewsOf,
  stepViewOf,
  taskViewOf,
  userInputViewsOf,
} from "./shared.ts";
import type { FallbackView, FinalView, FinalViewOptions, WindowOptions } from "./types.ts";

export function buildFinalView(data: ContextData, options: FinalViewOptions): FinalView {
  const shown = effectIdsOf(data);

  const reads = lastReadsWithData(data.calls, options.lastReads).filter((c) => !shown.has(c.id));
  reads.forEach((c) => shown.add(c.id));

  // Evidencia: las aprobadas primero (con su resumen) y, con los lugares que queden, las más recientes (líneas `L`).
  const rest = data.calls.filter((c) => !shown.has(c.id));
  const approved = lastN(rest.filter(isApproved), options.evidence);
  const others = lastN(rest.filter((c) => !isApproved(c)), Math.max(0, options.evidence - approved.length));

  const reactive = data.task.mode === "reactive";
  return {
    request: data.task.request,
    task: taskViewOf(data),
    steps: reactive ? [] : lastN(data.steps.filter((s) => !s.superseded), options.steps).map(stepViewOf),
    lastReads: reads.map((c) => callViewOf(data, c, true)),
    evidence: [...approved.map((c) => callViewOf(data, c, false)), ...others.map(lineViewOf)],
    userInput: userInputViewsOf(data),
    env: envViewsOf(data),
    effects: effectViewsOf(data),
    possibleEffects: possibleEffectViewsOf(data),
  };
}

export function buildFallbackView(data: ContextData, options: WindowOptions): FallbackView {
  const size = recentWindowSize(data.steps, options.recentWindows);
  const hidden = effectIdsOf(data);
  return {
    task: taskViewOf(data),
    lastActions: lastN(data.calls.filter((c) => !hidden.has(c.id)), size).map(lineViewOf),
    env: envViewsOf(data),
    effects: effectViewsOf(data),
    possibleEffects: possibleEffectViewsOf(data),
  };
}