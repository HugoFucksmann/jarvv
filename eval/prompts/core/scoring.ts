/**
 * eval/prompts/core/scoring.ts
 *
 * Portado de scripts/eval-next/core/results.ts (`computeScoreSummary`, `percentile`), con dos cambios:
 * separa por `bucket` (en vez de `isRaw`) y agrupa por `stageKey` (en vez de `stage`).
 */

import type { CaseScoreSummary, GlobalScoreSummary, RunRecord, StageName, StageScoreSummary } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

/** Etiqueta de la matriz de confusión cuando la decisión no produjo predicción (parseo fallido). */
export const NO_PREDICTION = "(sin predicción)";

/** Percentil por rango más cercano sobre un arreglo ya ordenado. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/** Una llamada que falló (red/timeout/HTTP) no mide al modelo: queda fuera de las latencias. */
function clientFailed(r: RunRecord): boolean {
  return r.metrics.client_call_ok === false;
}

/**
 * La latencia solo vale si la llamada se completó. Un run sin `client_call_ok` (p. ej. la variante no se
 * pudo aplicar y no hubo llamada) tiene durationMs 0 y falsearía el promedio y los percentiles.
 */
function hasLatency(r: RunRecord): boolean {
  return r.metrics.client_call_ok === true;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

export function computeScoreSummary(records: RunRecord[]): GlobalScoreSummary {
  const canonicalRecords = records.filter((r) => r.bucket === "canonical");
  const rawRecords = records.filter((r) => r.bucket === "raw");

  const byStageKey = groupBy(canonicalRecords, (r) => r.stageKey);
  const byStageKeyRaw = groupBy(rawRecords, (r) => r.stageKey);

  const stagesSummary: Record<string, StageScoreSummary> = {};

  let globalTotal = 0;
  let globalPassed = 0;
  let globalPassAllCases = 0;
  let globalTotalCases = 0;
  const globalDurations: number[] = [];
  let globalClientFailed = 0;
  let globalRawTotal = 0;
  let globalRawPassed = 0;

  const allStageKeys = new Set<string>([...byStageKey.keys(), ...byStageKeyRaw.keys()]);

  for (const stageKey of allStageKeys) {
    const stageRecords = byStageKey.get(stageKey) ?? [];
    const stageRawRecords = byStageKeyRaw.get(stageKey) ?? [];

    const byCase = groupBy(stageRecords, (r) => r.caseId);

    const casesSummary: CaseScoreSummary[] = [];
    let stPassed = 0;
    let stPassAllCases = 0;
    const stDurations: number[] = [];
    let stClientFailed = 0;

    const confusionMatrix: Record<string, Record<string, number>> = {};
    let correctDecisions = 0;
    let totalDecisions = 0;

    for (const [caseId, caseRecords] of byCase.entries()) {
      const n = caseRecords.length;
      const cPassed = caseRecords.filter((r) => r.passed).length;
      const okRecords = caseRecords.filter(hasLatency);
      const cDuration = okRecords.reduce((acc, r) => acc + r.durationMs, 0);

      stPassed += cPassed;
      for (const r of caseRecords) {
        if (clientFailed(r)) {
          stClientFailed++;
          globalClientFailed++;
        } else if (hasLatency(r)) {
          stDurations.push(r.durationMs);
          globalDurations.push(r.durationMs);
        }

        // Una decisión sin predicción (parseo fallido) cuenta como error. Si se excluyera,
        // la accuracy podía ser 100% con passRate < 100%. Las llamadas que fallaron por red
        // no traen expectedLabel y siguen fuera (no son un error de decisión).
        if (r.expectedLabel) {
          const predicted = r.predictedLabel || NO_PREDICTION;
          totalDecisions++;
          if (r.expectedLabel === predicted) correctDecisions++;
          confusionMatrix[r.expectedLabel] = confusionMatrix[r.expectedLabel] || {};
          confusionMatrix[r.expectedLabel][predicted] =
            (confusionMatrix[r.expectedLabel][predicted] || 0) + 1;
        }
      }

      const passRate = n > 0 ? cPassed / n : 0;

      // Varianza muestral: null cuando n=1 (una sola repetición → no hay varianza estimable)
      const variance: number | null =
        n > 1
          ? Math.round(
            ((cPassed * Math.pow(1 - passRate, 2) + (n - cPassed) * Math.pow(passRate, 2)) / (n - 1)) * 1000,
          ) / 1000
          : null;

      const passAll = cPassed === n;
      if (passAll) stPassAllCases++;

      const stage: StageName = caseRecords[0].stage;
      casesSummary.push({
        caseId,
        stage,
        runsCount: n,
        passCount: cPassed,
        passRate,
        variance,
        passAll,
        avgDurationMs: okRecords.length > 0 ? Math.round(cDuration / okRecords.length) : 0,
      });
    }

    const totalStRuns = stageRecords.length;
    const totalStCases = casesSummary.length;
    globalTotal += totalStRuns;
    globalPassed += stPassed;
    globalPassAllCases += stPassAllCases;
    globalTotalCases += totalStCases;

    const stRawTotal = stageRawRecords.length;
    const stRawPassed = stageRawRecords.filter((r) => r.passed).length;
    globalRawTotal += stRawTotal;
    globalRawPassed += stRawPassed;

    stDurations.sort((a, b) => a - b);
    const avgDurationMs =
      stDurations.length > 0 ? Math.round(stDurations.reduce((a, b) => a + b, 0) / stDurations.length) : 0;

    stagesSummary[stageKey] = {
      stageKey,
      totalRuns: totalStRuns,
      passedRuns: stPassed,
      passRate: totalStRuns > 0 ? stPassed / totalStRuns : 0,
      passAllRate: totalStCases > 0 ? stPassAllCases / totalStCases : 0,
      avgDurationMs,
      p50DurationMs: percentile(stDurations, 50),
      p95DurationMs: percentile(stDurations, 95),
      clientFailedRuns: stClientFailed,
      accuracy: totalDecisions > 0 ? Math.round((correctDecisions / totalDecisions) * 1000) / 1000 : undefined,
      confusionMatrix: totalDecisions > 0 ? confusionMatrix : undefined,
      rawTotalRuns: stRawTotal,
      rawPassedRuns: stRawPassed,
      rawPassRate: stRawTotal > 0 ? stRawPassed / stRawTotal : 0,
      cases: casesSummary,
    };
  }

  globalDurations.sort((a, b) => a - b);
  const avgGlobalDurationMs =
    globalDurations.length > 0 ? Math.round(globalDurations.reduce((a, b) => a + b, 0) / globalDurations.length) : 0;

  return {
    schemaVersion: SCHEMA_VERSION,
    totalRuns: globalTotal,
    passedRuns: globalPassed,
    passRate: globalTotal > 0 ? globalPassed / globalTotal : 0,
    passAllRate: globalTotalCases > 0 ? globalPassAllCases / globalTotalCases : 0,
    avgDurationMs: avgGlobalDurationMs,
    p50DurationMs: percentile(globalDurations, 50),
    p95DurationMs: percentile(globalDurations, 95),
    clientFailedRuns: globalClientFailed,
    rawTotalRuns: globalRawTotal,
    rawPassedRuns: globalRawPassed,
    rawPassRate: globalRawTotal > 0 ? globalRawPassed / globalRawTotal : 0,
    stages: stagesSummary,
  };
}