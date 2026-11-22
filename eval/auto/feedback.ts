/**
 * eval/auto/feedback.ts
 *
 * Lo que el código le cuenta al optimizador sobre cómo le fue al Top-1 en los datasets de desarrollo, sin mostrar casos:
 * - Etapas de decisión: errores por etiqueta (`extractConfusions`).
 * - Etapas generativas: tipos de fallo del evaluador con su conteo (`extractFailureKinds`).
 * - Resumen por variante y dataset del reporte comparativo (`extractVariantDatasetStats`).
 * Nunca mira datasets de `--holdout`.
 */

import { datasetName } from "../core/datasets.ts";
import type { ComparisonReport, InputCell } from "../core/report.ts";

export interface VariantDatasetStat {
  variant: string;
  dataset: string;
  stageKey: string;
  passRate: number;
  passedRuns: number;
  totalRuns: number;
  p50DurationMs?: number;
  retriedRuns: number;
  deltaPassRate?: number;
}

/** Cuántas veces la variante eligió `predicted` cuando lo correcto era `expected` (de `expectedTotal` casos con esa etiqueta). */
export interface ConfusionStat {
  expected: string;
  predicted: string;
  count: number;
  expectedTotal: number;
}

/** Solo datasets de desarrollo: nunca holdout. */
function devDatasetFilter(opts: { devDatasetNames: Set<string>; devDatasetPaths?: string[] }): (name: string) => boolean {
  const devPathNames = opts.devDatasetPaths && opts.devDatasetPaths.length > 0 ? new Set(opts.devDatasetPaths.map((p) => datasetName(p))) : null;
  return (name) => {
    if (devPathNames && !devPathNames.has(name)) return false;
    if (opts.devDatasetNames.size > 0 && !opts.devDatasetNames.has(name)) return false;
    return devPathNames !== null || opts.devDatasetNames.size > 0;
  };
}

const NO_VALID_ANSWER = "(sin respuesta válida)";
const MAX_CONFUSIONS = 8;

/**
 * Resumen de errores por etiqueta de la variante `focusVariant` en los datasets de desarrollo: solo etiquetas y conteos, sin texto de los
 * casos ni sus identificadores. Nunca mira datasets de holdout.
 */
export function extractConfusions(opts: {
  focusVariant: string;
  cells: InputCell[];
  devDatasetNames: Set<string>;
  devDatasetPaths?: string[];
}): ConfusionStat[] {
  const allowed = devDatasetFilter(opts);
  const totals = new Map<string, number>();
  const wrong = new Map<string, number>();
  for (const cell of opts.cells) {
    if (cell.variantSpec !== opts.focusVariant || !allowed(cell.datasetName)) continue;
    for (const r of cell.records) {
      if (r.bucket !== "canonical" || r.metrics?.client_call_ok === false) continue;
      if (r.expectedLabel === undefined || r.expectedLabel === null) continue;
      totals.set(r.expectedLabel, (totals.get(r.expectedLabel) ?? 0) + 1);
      if (r.passed) continue;
      const predicted = r.predictedLabel ?? NO_VALID_ANSWER;
      if (predicted === r.expectedLabel) continue; // falló por otro motivo (p. ej. probabilidad mínima), no es una confusión de etiqueta
      const key = `${r.expectedLabel}\u0000${predicted}`;
      wrong.set(key, (wrong.get(key) ?? 0) + 1);
    }
  }
  return [...wrong.entries()]
    .map(([key, count]) => {
      const [expected, predicted] = key.split("\u0000");
      return { expected, predicted, count, expectedTotal: totals.get(expected) ?? count };
    })
    .sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected) || a.predicted.localeCompare(b.predicted))
    .slice(0, MAX_CONFUSIONS);
}

/** Texto para el prompt del optimizador. */
export function formatConfusions(confusions: readonly ConfusionStat[]): string {
  if (confusions.length === 0) return "El Top-1 no tiene errores de etiqueta en los casos de desarrollo.";
  return confusions
    .map((c) => `- Cuando lo correcto era \`${c.expected}\`, eligió \`${c.predicted}\`: ${c.count} de ${c.expectedTotal} casos.`)
    .join("\n");
}


/** Un tipo de fallo del evaluador y en cuántos casos de desarrollo ocurrió (de `total`). */
export interface FailureKind {
  kind: string;
  count: number;
  total: number;
}

const MAX_FAILURE_KINDS = 8;

/**
 * Deja un mensaje de error del evaluador como tipo de fallo, sin lo propio de cada caso: quita lo que va entre comillas o después de dos puntos
 * (palabras clave, rutas, valores esperados) y reemplaza los números.
 */
export function failureKindOf(message: string): string {
  const kind = message
    .replace(/["'«»`][^"'«»`]*["'«»`]/g, "…")
    .replace(/:.*$/s, "")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim();
  return kind.length > 100 ? `${kind.slice(0, 100)}…` : kind;
}

/**
 * Tipos de fallo de la variante `focusVariant` en los datasets de desarrollo, con cuántos casos tuvo cada uno: sin texto de los casos, sin
 * identificadores y sin valores esperados. Es el equivalente de `extractConfusions` para las etapas generativas, que no tienen etiquetas.
 */
export function extractFailureKinds(opts: {
  focusVariant: string;
  cells: InputCell[];
  devDatasetNames: Set<string>;
  devDatasetPaths?: string[];
}): FailureKind[] {
  const allowed = devDatasetFilter(opts);
  const perKind = new Map<string, number>();
  let total = 0;
  for (const cell of opts.cells) {
    if (cell.variantSpec !== opts.focusVariant || !allowed(cell.datasetName)) continue;
    for (const r of cell.records) {
      if (r.bucket !== "canonical" || r.metrics?.client_call_ok === false) continue;
      total++;
      if (r.passed) continue;
      for (const kind of new Set((r.errors ?? []).map(failureKindOf).filter((k) => k !== ""))) perKind.set(kind, (perKind.get(kind) ?? 0) + 1);
    }
  }
  return [...perKind.entries()]
    .map(([kind, count]) => ({ kind, count, total }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
    .slice(0, MAX_FAILURE_KINDS);
}

/** Texto para el prompt del optimizador. */
export function formatFailureKinds(kinds: readonly FailureKind[]): string {
  if (kinds.length === 0) return "El Top-1 no tiene fallos en los casos de desarrollo.";
  return kinds.map((k) => `- ${k.kind}: ${k.count} de ${k.total} casos.`).join("\n");
}

/** Construye estadísticas por variante y dataset a partir del reporte comparativo. */
export function extractVariantDatasetStats(report: ComparisonReport, cells: InputCell[]): VariantDatasetStat[] {
  const deltaMap = new Map<string, number>();
  for (const d of report.deltas) {
    deltaMap.set(`${d.variant}\u0000${d.dataset}\u0000${d.stageKey}`, d.deltaPassRate);
  }

  const retryByCell = new Map<string, number>();
  for (const cell of cells) {
    for (const r of cell.records) {
      if (r.bucket !== "canonical") continue;
      if (Number(r.measurements?.attempts) > 1) {
        const key = `${cell.variantSpec}\u0000${cell.datasetName}\u0000${r.stageKey}`;
        retryByCell.set(key, (retryByCell.get(key) ?? 0) + 1);
      }
    }
  }

  return report.cells.map((c) => {
    const key = `${c.variant}\u0000${c.dataset}\u0000${c.stageKey}`;
    return {
      variant: c.variant,
      dataset: c.dataset,
      stageKey: c.stageKey,
      passRate: c.passRate,
      passedRuns: c.passedRuns,
      totalRuns: c.totalRuns,
      ...(c.p50DurationMs !== undefined ? { p50DurationMs: c.p50DurationMs } : {}),
      retriedRuns: retryByCell.get(key) ?? 0,
      ...(deltaMap.has(key) ? { deltaPassRate: deltaMap.get(key) } : {}),
    };
  });
}
