/**
 * eval/ui/order.ts
 *
 * Orden compartido por `--list` y el asistente (`--menu`). Datasets y variantes ya llegan ordenados desde
 * `listDatasetNames()` / `listVariantNames()`; aquí solo se agrega lo que ellos no saben: la baseline primero y el
 * agrupado de etapas.
 */

import { allStageNames, stageNamesByType } from "../core/stages/index.ts";

/** Mueve la baseline al principio (si existe) y conserva el orden del resto. */
export function baselineFirst(names: readonly string[], baseline: string): string[] {
  return names.includes(baseline) ? [baseline, ...names.filter((n) => n !== baseline)] : [...names];
}

/** Etapas agrupadas (decisión, generativas, otras), conservando el orden de `allStageNames()` dentro de cada grupo. */
export function groupStages(): Array<[string, string[]]> {
  const decision = stageNamesByType("decision") as string[];
  const generative = stageNamesByType("generative") as string[];
  const other = (allStageNames() as string[]).filter((s) => !decision.includes(s) && !generative.includes(s));
  return [
    ["Decisión", decision],
    ["Generativas", generative],
    ["Otras", other],
  ];
}

/** Todas las etapas en el orden de `groupStages()`. */
export const orderedStages = (): string[] => groupStages().flatMap(([, items]) => items);