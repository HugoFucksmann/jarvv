/**
 * eval/core/report-types.ts
 *
 * Tipos del reporte de comparación compartidos entre `report.ts`, `report-format.ts`,
 * `batch.ts`, `auto/ranking.ts`, `auto/feedback.ts` y las vistas de consola.
 * Extraídos fuera de `report.ts` para evitar dependencias circulares con `report-format.ts`.
 */

import type { GlobalScoreSummary, QuestionCross, QuestionScore, RunRecord } from "./types.ts";

export interface InputCell {
  variantSpec: string;
  datasetName: string;
  scores: GlobalScoreSummary;
  records: RunRecord[];
  /** Carpeta de la celda en disco (para leer `runs.jsonl` bajo demanda sin retener payloads en RAM). */
  cellDir?: string;
}

export interface CellStageReport {
  variant: string;
  dataset: string;
  stageKey: string;
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  passAllRate: number;
  /** Casos distintos de la etapa; `totalRuns > cases` indica repeticiones. */
  cases: number;
  /** undefined si ninguna llamada se completó: no hay latencia que medir (no es 0ms). */
  p50DurationMs?: number;
  p95DurationMs?: number;
  latencySamples: number;
  /** Runs del bucket raw (adversariales o prod_shortcut): no suman en passRate. */
  rawTotalRuns: number;
  rawPassedRuns: number;
  tokens?: {
    avgPrompt: number;
    avgCompletion: number;
    avgTotal: number;
  };
  /** true si algún record de la etapa trae tokens estimados (caracteres/3) y no medidos. */
  tokensEstimated?: boolean;
  accuracy?: number;
  confusionMatrix?: Record<string, Record<string, number>>;
  /** Etapas con 2 o más preguntas evaluadas: métricas por pregunta (FP/FN por clase) y cruces. */
  questions?: Record<string, QuestionScore>;
  questionCross?: QuestionCross[];
}

export interface ComparisonDelta {
  variant: string;
  dataset: string;
  stageKey: string;
  /** Casos medidos en ambos lados: base de `deltaPassRate`. */
  pairedCases: number;
  /** Media de (passRate variante − baseline) por caso, solo sobre casos medidos en ambos lados. */
  deltaPassRate: number;
  deltaAccuracy?: number;
  deltaP50Ms?: number;
  /** Solo con al menos `MIN_P95_SAMPLES` muestras en ambos lados. */
  deltaP95Ms?: number;
}

export interface CaseComparison {
  variant: string;
  dataset: string;
  caseId: string;
  stageKey: string;
  baseline: string;
  variantResult: string;
  diff: string;
}

/** Una fila por variante, agregada sobre todos los datasets y etapas corridos. */
export interface VariantSummary {
  variant: string;
  /** Tipo de etapas que resume la fila; `total` mezcla ambos y solo existe si la corrida tiene los dos tipos. */
  kind?: "generative" | "decision" | "total";
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  /** Media de passRate por etapa (`final[think=on/off]` es una sola): cada etapa pesa igual, tenga los casos que tenga. */
  macroPassRate: number;
  /**
   * Diferencia contra la baseline, solo sobre casos medidos en ambos lados (undefined si es la baseline o no hay
   * ninguno). Así es coherente con regresiones y mejoras: una caída de red no se lee como un peor prompt.
   */
  deltaPassRate?: number;
  /** Igual que `deltaPassRate`, con cada etapa pesando igual. */
  deltaMacroPassRate?: number;
  /** Runs cuya llamada al cliente falló: cuentan como falla en passRate. */
  clientFailedRuns: number;
  /** Runs que necesitaron un reintento por salida inválida o truncada para llegar a su resultado. */
  retriedRuns: number;
  regressions: number;
  improvements: number;
  /** Prueba de signos exacta (dos colas) sobre regresiones vs mejoras. Ver `signTestP`. */
  signTestP?: number;
  /** Mediana de latencia de los runs con llamada exitosa. undefined sin muestras o en `total`, que mezcla escalas. */
  p50DurationMs?: number;
}

export interface ComparisonReport {
  baseline: string;
  /** Resumen agregado por variante (en el orden en que corrieron). */
  variants: VariantSummary[];
  cells: CellStageReport[];
  deltas: ComparisonDelta[];
  regressions: CaseComparison[];
  improvements: CaseComparison[];
  /** Lo mismo para el bucket raw, que no suma en passRate pero no debe empeorar sin que se vea. */
  rawRegressions: CaseComparison[];
  rawImprovements: CaseComparison[];
  /** Avisos que condicionan cómo leer el reporte (baseline ausente, concurrencia, ...). */
  warnings: string[];
}
