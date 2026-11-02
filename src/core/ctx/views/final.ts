/**
 * `forFinal` y `forFallback` (sección 8): cierre de la tarea. Ambas muestran todos los efectos y posibles efectos sin
 * recorte. `forFinal` alimenta al modelo que redacta la respuesta; `forFallback`, la respuesta de respaldo sin modelo
 * (también la de `cancelled`).
 */

import { lastN, recentFailures, recentWindowSize } from "../derive.ts";
import type { ContextData } from "../types.ts";
import {
  effectViewsOf,
  factViewsOf,
  failureViewOf,
  possibleEffectViewsOf,
  stepViewOf,
} from "./shared.ts";
import type { FallbackView, FinalView, WindowOptions } from "./types.ts";

export function buildFinalView(data: ContextData): FinalView {
  return {
    request: data.task.request,
    state: data.task.state,
    stopReason: data.task.stopReason,
    steps: data.steps.map(stepViewOf),
    evidence: data.calls.map((c) => failureViewOf(data, c)),
    effects: effectViewsOf(data),
    possibleEffects: possibleEffectViewsOf(data),
    facts: factViewsOf(data),
  };
}

export function buildFallbackView(data: ContextData, options: WindowOptions): FallbackView {
  const size = recentWindowSize(data.steps, options.recentWindows);
  return {
    state: data.task.state,
    stopReason: data.task.stopReason,
    failures: recentFailures(data.calls, size).map((c) => failureViewOf(data, c)),
    effects: effectViewsOf(data),
    possibleEffects: possibleEffectViewsOf(data),
    facts: factViewsOf(data),
    lastActions: lastN(data.calls, size).map((c) => failureViewOf(data, c)),
  };
}
