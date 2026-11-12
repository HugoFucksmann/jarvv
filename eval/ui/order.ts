/**
 * eval/ui/order.ts
 *
 * Orden compartido por `--list` y el asistente (`--menu`). Datasets y variantes ya llegan ordenados desde
 * `listDatasetNames()` / `listVariantNames()`; aquí solo se agrega lo que ellos no saben: la baseline primero y el
 * agrupado de etapas.
 */

import { DECISION_STAGES, GENERATIVE_STAGES } from "../core/case.ts";
import { allStageNames } from "../core/stages/index.ts";

/** Mueve la baseline al principio (si existe) y conserva el orden del resto. */
export function baselineFirst(names: readonly string[], baseline: string): string[] {
  return names.includes(baseline) ? [baseline, ...names.filter((n) => n !== baseline)] : [...names];
}

/** Etapas agrupadas (decisión, generativas, otras), conservando el orden de `allStageNames()` dentro de cada grupo. */
export function groupStages(): Array<[string, string[]]> {
  const stages = allStageNames() as string[];
  const decision = DECISION_STAGES as readonly string[];
  const generative = GENERATIVE_STAGES as readonly string[];
  return [
    ["Decisión", stages.filter((s) => decision.includes(s))],
    ["Generativas", stages.filter((s) => generative.includes(s))],
    ["Otras", stages.filter((s) => !decision.includes(s) && !generative.includes(s))],
  ];
}

/** Todas las etapas en el orden de `groupStages()`. */
export const orderedStages = (): string[] => groupStages().flatMap(([, items]) => items);