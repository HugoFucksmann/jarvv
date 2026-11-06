/**
 * eval/core/report.ts
 *
 * Genera comparison.json y comparison.md, y el resumen en consola.
 * Sección 9 del plan de implementación.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DECISION_STAGES } from "./case.ts";
import { hasLatency, isDecisionCorrect, percentile } from "./scoring.ts";
import type { GlobalScoreSummary, QuestionCross, QuestionScore, RunRecord, StageName } from "./types.ts";

/** Por debajo de esto, el p95 por rango más cercano es el máximo de la muestra: no se publica su delta. */
const MIN_P95_SAMPLES = 20;

export interface InputCell {
  variantSpec: string;
  datasetName: string;
  scores: GlobalScoreSummary;
  records: RunRecord[];
  /** Modelo de la celda cuando la corrida compara modelos; undefined en la corrida de un solo modelo. */
  model?: string;
  /** Tipo de etapas que cubre la celda; los modelos solo se comparan entre celdas del mismo tipo. */
  scope?: "all" | "generative" | "decision";
}

/** Clave para emparejar celdas del mismo modelo (baseline vs variante). */
const modelKey = (model: string | undefined): string => model ?? "";

export interface CellStageReport {
  variant: string;
  dataset: string;
  model?: string;
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
  model?: string;
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
  model?: string;
  caseId: string;
  stageKey: string;
  baseline: string;
  variantResult: string;
  diff: string;
}

/** Una fila por variante, agregada sobre todos los datasets y etapas corridos. */
export interface VariantSummary {
  variant: string;
  /** Solo cuando la corrida compara modelos: una fila por (variante, modelo). */
  model?: string;
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
  /** Runs donde la variante no se pudo aplicar (no hubo llamada): cuentan como falla en passRate. */
  variantApplyFailedRuns: number;
  /** Runs que necesitaron un reintento por salida inválida o truncada para llegar a su resultado. */
  retriedRuns: number;
  regressions: number;
  improvements: number;
  /** Prueba de signos exacta (dos colas) sobre regresiones vs mejoras. Ver `signTestP`. */
  signTestP?: number;
  /** Mediana de latencia de los runs con llamada exitosa. undefined sin muestras o en `total`, que mezcla escalas. */
  p50DurationMs?: number;
}

/** Una fila de la comparación directa entre modelos. Los deltas son contra el primer modelo de la lista. */
export interface ModelRow {
  model: string;
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  accuracy?: number;
  /** undefined si ninguna llamada se completó: no hay latencia que medir (no es 0ms). */
  p50DurationMs?: number;
  p95DurationMs?: number;
  latencySamples: number;
  clientFailedRuns: number;
  /** Runs que necesitaron un reintento por salida inválida o truncada. */
  retriedRuns: number;
  /**
   * Decisiones con opciones (route, tool_choice, args_review): probabilidad media que el modelo da a la opción correcta
   * y errores cometidos con seguridad (probabilidad alta en la opción equivocada). undefined si no hay probabilidades.
   */
  calibration?: { avgCorrectProb: number; brier: number; errors: number; confidentErrors: number };
  tokens?: { avgPrompt: number; avgCompletion: number; avgTotal: number };
  tokensEstimated?: boolean;
  /** Deltas contra la referencia, solo sobre casos medidos en ambos modelos. */
  deltaPassRate?: number;
  deltaAccuracy?: number;
  deltaP50Ms?: number;
  deltaP95Ms?: number;
  /** Casos que este modelo acierta más / menos que la referencia, y su prueba de signos. */
  casesBetter?: number;
  casesWorse?: number;
  signTestP?: number;
}

export interface ModelComparison {
  variant: string;
  dataset: string;
  scope: "generative" | "decision" | "all";
  /** Modelo contra el que se calculan los deltas (el primero que corrió). */
  reference: string;
  models: string[];
  /** Modelos sin ninguna llamada exitosa (p. ej. un LLM usado como modelo de decisión): no aportan datos comparables. */
  noData: string[];
  overall: ModelRow[];
  stages: Array<{ stageKey: string; rows: ModelRow[] }>;
  /** Accuracy por pregunta y modelo (etapas de decisión con varias preguntas). */
  questions: Array<{
    stageKey: string;
    question: string;
    role: "main" | "extra";
    /**
     * `fp` y `fn` solo en preguntas sí/no (clase positiva "yes"); en las demás, ver las tablas por clase.
     * Acá `fp + fn + unanswered = errors`: no responder no es ni FP ni FN.
     */
    rows: Array<{ model: string; accuracy: number; graded: number; errors: number; unanswered: number; fp?: number; fn?: number }>;
  }>;
  /** Decisiones: aciertos por clase esperada y modelo, solo de las clases donde algún modelo se equivoca. */
  classes: Array<{ stageKey: string; label: string; rows: Array<{ model: string; correct: number; total: number }> }>;
  /** Checks que fallaron en algún modelo, con en cuántos runs falló cada uno (más fallado primero). */
  checks: Array<{ stageKey: string; check: string; rows: Array<{ model: string; failed: number; total: number }> }>;
  /** Casos medidos en todos los modelos: los únicos donde se buscan discrepancias. */
  comparedCases: number;
  /** Casos donde los modelos no obtuvieron lo mismo (pasa/falla). */
  disagreements: Array<{ caseId: string; stageKey: string; results: Record<string, string> }>;
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
  /** Comparación directa entre modelos (vacío si la corrida usó un solo modelo por tipo de etapa). */
  modelComparisons: ModelComparison[];
  /** Avisos que condicionan cómo leer el reporte (baseline ausente, concurrencia, ...). */
  warnings: string[];
}

/**
 * Solo un run cuya llamada se completó mide al modelo. Una falla de cliente (red, timeout, HTTP) o una variante que no
 * se pudo aplicar (no hubo llamada) no dice nada sobre el prompt: no debe aparecer como regresión ni como mejora.
 */
const isComparable = hasLatency;

/** Un caso (dataset, caseId, stageKey) medido en ambos lados de una comparación. */
interface PairedCase {
  dataset: string;
  caseId: string;
  stage: StageName;
  stageKey: string;
  basePassed: number;
  baseTotal: number;
  passed: number;
  total: number;
}

/**
 * Empareja por caso. El caso es la unidad de comparación: las repeticiones de un caso no son muestras independientes.
 * `unpaired` cuenta los casos sin runs comparables en alguno de los lados.
 */
function pairCases(
  base: RunRecord[],
  other: RunRecord[],
  success: (r: RunRecord) => boolean = (r) => r.passed,
): { pairs: PairedCase[]; unpaired: number } {
  const keyOf = (r: RunRecord): string => `${r.dataset}\u0000${r.caseId}\u0000${r.stageKey}`;
  const group = (records: RunRecord[]): Map<string, RunRecord[]> => {
    const m = new Map<string, RunRecord[]>();
    for (const r of records.filter(isComparable)) {
      const list = m.get(keyOf(r)) ?? [];
      list.push(r);
      m.set(keyOf(r), list);
    }
    return m;
  };
  const baseCases = group(base);
  const otherCases = group(other);
  const pairs: PairedCase[] = [];
  for (const [key, list] of otherCases) {
    const baseList = baseCases.get(key);
    if (!baseList) continue;
    const { dataset, caseId, stage, stageKey } = list[0];
    pairs.push({
      dataset,
      caseId,
      stage,
      stageKey,
      basePassed: baseList.filter(success).length,
      baseTotal: baseList.length,
      passed: list.filter(success).length,
      total: list.length,
    });
  }
  const allKeys = new Set([...base, ...other].map(keyOf));
  return { pairs, unpaired: allKeys.size - pairs.length };
}

const pairDelta = (p: PairedCase): number => p.passed / p.total - p.basePassed / p.baseTotal;

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Prueba de signos exacta de dos colas: si la variante no cambiara nada, cada caso que cambia tendría la misma chance
 * de mejorar o empeorar. Un p alto significa que el resultado es compatible con ruido, no que no haya efecto. Con menos
 * de 6 casos que cambian, nunca baja de 0.05.
 */
function signTestP(better: number, worse: number): number | undefined {
  const n = better + worse;
  if (n === 0) return undefined;
  let tail = 0;
  let combinations = 1;
  for (let i = 0; i <= Math.min(better, worse); i++) {
    tail += combinations;
    combinations = (combinations * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

function pairedSummary(pairs: PairedCase[]): { delta?: number; better: number; worse: number; signTestP?: number } {
  const deltas = pairs.map(pairDelta);
  const better = deltas.filter((d) => d > 0).length;
  const worse = deltas.filter((d) => d < 0).length;
  const p = signTestP(better, worse);
  return { ...(pairs.length > 0 ? { delta: mean(deltas) } : {}), better, worse, ...(p !== undefined ? { signTestP: p } : {}) };
}

function fmtP(p: number | undefined): string {
  if (p === undefined) return "—";
  return p < 0.001 ? "<0.001" : p.toFixed(3);
}

/** Latencias de los runs con llamada completada. */
function latencies(records: RunRecord[]): { p50?: number; p95?: number; samples: number } {
  const durations = records.filter(hasLatency).map((r) => r.durationMs).sort((a, b) => a - b);
  if (durations.length === 0) return { samples: 0 };
  return { p50: percentile(durations, 50), p95: percentile(durations, 95), samples: durations.length };
}

function fmtPct(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

function fmtDeltaPct(r: number): string {
  const sign = r > 0 ? "+" : "";
  return `${sign}${(r * 100).toFixed(1)}%`;
}

function fmtDeltaMs(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}ms`;
}

/**
 * Calcula los tokens promedio para un conjunto de records canonical.
 */
function computeAvgTokens(records: RunRecord[]): { avgPrompt: number; avgCompletion: number; avgTotal: number } | undefined {
  const withTokens = records.filter((r) => r.tokens !== undefined);
  if (withTokens.length === 0) return undefined;

  let sumPrompt = 0;
  let sumComp = 0;
  let sumTotal = 0;
  for (const r of withTokens) {
    sumPrompt += r.tokens?.prompt ?? 0;
    sumComp += r.tokens?.completion ?? 0;
    sumTotal += r.tokens?.total ?? 0;
  }
  const count = withTokens.length;
  return {
    avgPrompt: Math.round(sumPrompt / count),
    avgCompletion: Math.round(sumComp / count),
    avgTotal: Math.round(sumTotal / count),
  };
}

/**
 * Genera el reporte de comparación a partir de las celdas ejecutadas.
 */
export function generateComparisonReport(opts: {
  baseline: string;
  cells: InputCell[];
  /** Concurrencia de la corrida; si es > 1 se advierte sobre las latencias. */
  concurrency?: number;
}): ComparisonReport {
  const { baseline, cells } = opts;

  // 1. Extraer resúmenes por (variante, dataset, stageKey)
  const cellReports: CellStageReport[] = [];

  for (const cell of cells) {
    const canonicalRecords = cell.records.filter((r) => r.bucket === "canonical");

    for (const [stageKey, stageSummary] of Object.entries(cell.scores.stages)) {
      const stageRecords = canonicalRecords.filter((r) => r.stageKey === stageKey);
      const tokens = computeAvgTokens(stageRecords);
      const tokensEstimated = stageRecords.some((r) => r.tokensEstimated === true);
      const hasSamples = stageSummary.latencySamples > 0;

      cellReports.push({
        variant: cell.variantSpec,
        dataset: cell.datasetName,
        ...(cell.model !== undefined ? { model: cell.model } : {}),
        stageKey,
        totalRuns: stageSummary.totalRuns,
        passedRuns: stageSummary.passedRuns,
        passRate: stageSummary.passRate,
        passAllRate: stageSummary.passAllRate,
        cases: stageSummary.cases.length,
        ...(hasSamples ? { p50DurationMs: stageSummary.p50DurationMs, p95DurationMs: stageSummary.p95DurationMs } : {}),
        latencySamples: stageSummary.latencySamples,
        rawTotalRuns: stageSummary.rawTotalRuns,
        rawPassedRuns: stageSummary.rawPassedRuns,
        ...(tokens ? { tokens } : {}),
        ...(tokens && tokensEstimated ? { tokensEstimated: true } : {}),
        ...(stageSummary.accuracy !== undefined ? { accuracy: stageSummary.accuracy } : {}),
        ...(stageSummary.confusionMatrix ? { confusionMatrix: stageSummary.confusionMatrix } : {}),
        ...(stageSummary.questions ? { questions: stageSummary.questions } : {}),
        ...(stageSummary.questionCross ? { questionCross: stageSummary.questionCross } : {}),
      });
    }
  }

  // 2. Comparar cada celda contra la baseline del mismo dataset y modelo (con varios modelos, cada uno contra sí mismo).
  const deltas: ComparisonDelta[] = [];
  const regressions: CaseComparison[] = [];
  const improvements: CaseComparison[] = [];
  const rawRegressions: CaseComparison[] = [];
  const rawImprovements: CaseComparison[] = [];
  const unpairedByVariant = new Map<string, number>();

  const reportsOf = (cell: InputCell): CellStageReport[] =>
    cellReports.filter((c) => c.variant === cell.variantSpec && c.dataset === cell.datasetName && modelKey(c.model) === modelKey(cell.model));

  for (const cell of cells) {
    if (cell.variantSpec === baseline) continue;
    const base = cells.find(
      (c) => c.variantSpec === baseline && c.datasetName === cell.datasetName && modelKey(c.model) === modelKey(cell.model),
    );
    if (!base) continue;

    const inBucket = (c: InputCell, bucket: RunRecord["bucket"]): RunRecord[] => c.records.filter((r) => r.bucket === bucket);
    const baseCanonical = inBucket(base, "canonical");
    const cellCanonical = inBucket(cell, "canonical");
    const { pairs, unpaired } = pairCases(baseCanonical, cellCanonical);
    if (unpaired > 0) unpairedByVariant.set(cell.variantSpec, (unpairedByVariant.get(cell.variantSpec) ?? 0) + unpaired);

    // Deltas por stageKey
    const baseStages = new Map(reportsOf(base).map((r) => [r.stageKey, r]));
    for (const vStage of reportsOf(cell)) {
      const bStage = baseStages.get(vStage.stageKey);
      const stagePairs = pairs.filter((p) => p.stageKey === vStage.stageKey);
      if (!bStage || stagePairs.length === 0) continue;

      const decided = (records: RunRecord[]): RunRecord[] => records.filter((r) => r.stageKey === vStage.stageKey && r.expectedLabel);
      const accuracy = pairedSummary(pairCases(decided(baseCanonical), decided(cellCanonical), isDecisionCorrect).pairs);
      const enoughP95 = bStage.latencySamples >= MIN_P95_SAMPLES && vStage.latencySamples >= MIN_P95_SAMPLES;

      deltas.push({
        variant: cell.variantSpec,
        dataset: cell.datasetName,
        ...(cell.model !== undefined ? { model: cell.model } : {}),
        stageKey: vStage.stageKey,
        pairedCases: stagePairs.length,
        deltaPassRate: r3(mean(stagePairs.map(pairDelta))),
        ...(accuracy.delta !== undefined ? { deltaAccuracy: r3(accuracy.delta) } : {}),
        ...(vStage.p50DurationMs !== undefined && bStage.p50DurationMs !== undefined
          ? { deltaP50Ms: vStage.p50DurationMs - bStage.p50DurationMs }
          : {}),
        ...(enoughP95 ? { deltaP95Ms: (vStage.p95DurationMs as number) - (bStage.p95DurationMs as number) } : {}),
      });
    }

    // Regresiones y mejoras por caso. Salen de los mismos pares que los deltas: no pueden contradecirlos.
    const classify = (casePairs: PairedCase[], worse: CaseComparison[], better: CaseComparison[]): void => {
      for (const p of casePairs) {
        const d = pairDelta(p);
        if (d === 0) continue;
        const single = p.baseTotal === 1 && p.total === 1;
        const baselineStr = single ? (p.basePassed === 1 ? "pasa" : "falla") : `${p.basePassed}/${p.baseTotal}`;
        const variantStr = single ? (p.passed === 1 ? "pasa" : "falla") : `${p.passed}/${p.total}`;
        (d < 0 ? worse : better).push({
          variant: cell.variantSpec,
          dataset: cell.datasetName,
          ...(cell.model !== undefined ? { model: cell.model } : {}),
          caseId: p.caseId,
          stageKey: p.stageKey,
          baseline: baselineStr,
          variantResult: variantStr,
          diff: `${baselineStr} -> ${variantStr}`,
        });
      }
    };
    classify(pairs, regressions, improvements);
    classify(pairCases(inBucket(base, "raw"), inBucket(cell, "raw")).pairs, rawRegressions, rawImprovements);
  }

  const warnings: string[] = [];
  const hasBaseline = cells.some((c) => c.variantSpec === baseline);
  const hasOthers = cells.some((c) => c.variantSpec !== baseline);
  if (hasOthers && !hasBaseline) {
    warnings.push(
      `La baseline \`${baseline}\` no se ejecutó: no hay deltas, regresiones ni mejoras (la ausencia no implica que no haya cambios).`,
    );
  }
  for (const [variant, count] of unpairedByVariant) {
    warnings.push(
      `\`${variant}\`: ${count} caso(s) sin medición comparable contra la baseline (llamada fallida, variante no aplicada o etapa distinta). ` +
        "Cuentan como falla en su passRate pero quedan fuera de Δ, regresiones y mejoras: passRate y Δ pueden no cuadrar.",
    );
  }
  if ((opts.concurrency ?? 1) > 1 && (deltas.length > 0 || cells.some((c) => c.model !== undefined))) {
    warnings.push(
      `Concurrencia ${opts.concurrency}: las latencias (p50/p95 y Δ p50) pueden incluir espera en el servidor y no son comparables entre variantes; usar --concurrency=1 para medir latencia.`,
    );
  }

  const variantSummaries = summarizeVariants(baseline, cells);
  warnings.push(...mixedVerdictWarnings(variantSummaries));

  return {
    baseline,
    variants: variantSummaries,
    cells: cellReports,
    deltas,
    regressions,
    improvements,
    rawRegressions,
    rawImprovements,
    modelComparisons: compareModels(cells),
    warnings,
  };
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/** FP/FN de una pregunta sí/no (positiva = "yes"), sin contar las no respondidas. undefined si tiene otras clases. */
function yesNoFpFn(q: QuestionScore): { fp: number; fn: number } | undefined {
  const keys = Object.keys(q.perClass);
  if (keys.length === 0 || !keys.every((k) => k === "yes" || k === "no")) return undefined;
  return { fp: q.confusionMatrix["no"]?.["yes"] ?? 0, fn: q.confusionMatrix["yes"]?.["no"] ?? 0 };
}

/** "FP 1, FN 2, sin respuesta 1" para preguntas sí/no (suman los errores); "errores N" para el resto. */
function errorSummary(q: { errors: number; unanswered: number }, fpfn: { fp: number; fn: number } | undefined): string {
  if (!fpfn) return `errores ${q.errors}`;
  return `FP ${fpfn.fp}, FN ${fpfn.fn}${q.unanswered > 0 ? `, sin respuesta ${q.unanswered}` : ""}`;
}

/** Una probabilidad igual o mayor en la opción equivocada es un error cometido "con seguridad". */
const CONFIDENT_PROB = 0.8;

/** Calibración de las decisiones con opciones. Las de `noul` (ok/cumple) no tienen una probabilidad por opción: no cuentan. */
function calibration(records: RunRecord[]): ModelRow["calibration"] {
  const probOf = (r: RunRecord, label: string | null | undefined): number | undefined =>
    label ? r.probabilities?.[label] : undefined;
  const withProb = records.filter((r) => r.expectedLabel && probOf(r, r.expectedLabel) !== undefined);
  if (withProb.length === 0) return undefined;
  const wrong = withProb.filter((r) => !isDecisionCorrect(r));
  // Brier: error cuadrático medio de las probabilidades contra la opción correcta (0 = perfecto; menor es mejor).
  const brier = (r: RunRecord): number =>
    Object.entries(r.probabilities ?? {}).reduce((acc, [label, p]) => acc + (p - (label === r.expectedLabel ? 1 : 0)) ** 2, 0);
  return {
    avgCorrectProb: mean(withProb.map((r) => probOf(r, r.expectedLabel) as number)),
    brier: mean(withProb.map(brier)),
    errors: wrong.length,
    confidentErrors: wrong.filter((r) => (probOf(r, r.predictedLabel) ?? 0) >= CONFIDENT_PROB).length,
  };
}

/** Cuántos runs fallaron cada check (`metrics[check] === false`). */
function failedChecks(records: RunRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of records) {
    for (const [check, ok] of Object.entries(r.metrics ?? {})) if (ok === false) out.set(check, (out.get(check) ?? 0) + 1);
  }
  return out;
}

/** Fila de modelo para un conjunto de celdas ya filtradas (una celda de un modelo o una etapa de ella). */
function modelRow(model: string, records: RunRecord[]): ModelRow {
  const canonical = records.filter((r) => r.bucket === "canonical");
  // Misma regla que scoring: una decisión sin predicción cuenta como error.
  const decided = canonical.filter((r) => r.expectedLabel);
  const accuracy = decided.length > 0 ? decided.filter(isDecisionCorrect).length / decided.length : undefined;
  const latency = latencies(canonical);
  const passedRuns = canonical.filter((r) => r.passed).length;
  const tokens = computeAvgTokens(canonical);
  const calib = calibration(canonical);
  return {
    model,
    totalRuns: canonical.length,
    passedRuns,
    passRate: canonical.length > 0 ? passedRuns / canonical.length : 0,
    ...(accuracy !== undefined ? { accuracy } : {}),
    ...(calib ? { calibration: calib } : {}),
    retriedRuns: canonical.filter((r) => Number(r.measurements?.attempts) > 1).length,
    ...(latency.samples > 0 ? { p50DurationMs: latency.p50, p95DurationMs: latency.p95 } : {}),
    latencySamples: latency.samples,
    clientFailedRuns: canonical.filter((r) => r.metrics?.client_call_ok === false).length,
    ...(tokens ? { tokens } : {}),
    ...(tokens && canonical.some((r) => r.tokensEstimated === true) ? { tokensEstimated: true } : {}),
  };
}

/**
 * Rellena los deltas de cada fila contra la primera (el modelo de referencia). `records[i]` son los runs de `rows[i]`.
 * Los de acierto salen de casos medidos en ambos modelos: un modelo sin llamadas exitosas no tiene delta (no es -100%).
 */
function fillDeltas(rows: ModelRow[], records: RunRecord[][]): void {
  const ref = rows[0];
  if (!ref) return;
  const canonical = (rs: RunRecord[]): RunRecord[] => rs.filter((r) => r.bucket === "canonical");
  const decided = (rs: RunRecord[]): RunRecord[] => canonical(rs).filter((r) => r.expectedLabel);
  rows.slice(1).forEach((row, i) => {
    const other = records[i + 1];
    const pass = pairedSummary(pairCases(canonical(records[0]), canonical(other)).pairs);
    const acc = pairedSummary(pairCases(decided(records[0]), decided(other), isDecisionCorrect).pairs);
    if (pass.delta !== undefined) {
      row.deltaPassRate = r3(pass.delta);
      row.casesBetter = pass.better;
      row.casesWorse = pass.worse;
      if (pass.signTestP !== undefined) row.signTestP = pass.signTestP;
    }
    if (acc.delta !== undefined) row.deltaAccuracy = r3(acc.delta);
    if (ref.p50DurationMs !== undefined && row.p50DurationMs !== undefined) row.deltaP50Ms = row.p50DurationMs - ref.p50DurationMs;
    if (ref.latencySamples >= MIN_P95_SAMPLES && row.latencySamples >= MIN_P95_SAMPLES) {
      row.deltaP95Ms = (row.p95DurationMs as number) - (ref.p95DurationMs as number);
    }
  });
}

/**
 * Compara modelos entre sí: agrupa celdas por (variante, dataset, tipo de etapas) y, si un grupo tiene dos o más
 * modelos, arma la tabla global, por etapa, por pregunta y la lista de casos donde discrepan.
 */
export function compareModels(cells: InputCell[]): ModelComparison[] {
  const groups = new Map<string, InputCell[]>();
  for (const c of cells) {
    if (c.model === undefined) continue;
    const key = `${c.variantSpec}\u0000${c.datasetName}\u0000${c.scope ?? "all"}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const out: ModelComparison[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const models = group.map((c) => c.model as string);
    const first = group[0];

    const overall = group.map((c) => modelRow(c.model as string, c.records));
    fillDeltas(overall, group.map((c) => c.records));
    const noData = overall.filter((r) => r.totalRuns > 0 && r.clientFailedRuns === r.totalRuns).map((r) => r.model);

    const stageKeys = [...new Set(group.flatMap((c) => Object.keys(c.scores.stages)))];
    const stages = stageKeys.map((stageKey) => {
      const perCell = group.map((c) => c.records.filter((r) => r.stageKey === stageKey));
      const rows = group.map((c, i) => modelRow(c.model as string, perCell[i]));
      fillDeltas(rows, perCell);
      return { stageKey, rows };
    });

    const questions: ModelComparison["questions"] = [];
    for (const stageKey of stageKeys) {
      const names = new Set<string>();
      for (const c of group) for (const k of Object.keys(c.scores.stages[stageKey]?.questions ?? {})) names.add(k);
      for (const question of [...names].sort()) {
        const rows: ModelComparison["questions"][number]["rows"] = [];
        let role: "main" | "extra" = "extra";
        for (const c of group) {
          const q = c.scores.stages[stageKey]?.questions?.[question];
          if (!q) continue;
          role = q.role;
          rows.push({
            model: c.model as string,
            accuracy: q.accuracy,
            graded: q.graded,
            errors: q.graded - q.correct,
            unanswered: q.unanswered,
            ...yesNoFpFn(q),
          });
        }
        if (rows.length > 0) questions.push({ stageKey, question, role, rows });
      }
    }

    // Decisiones: en qué clases se equivoca cada modelo (de la matriz de confusión de su celda).
    const classes: ModelComparison["classes"] = [];
    for (const stageKey of stageKeys) {
      const matrices = group.map((c) => c.scores.stages[stageKey]?.confusionMatrix);
      const labels = new Set<string>(matrices.flatMap((m) => Object.keys(m ?? {})));
      for (const label of labels) {
        const rows = group.map((c, i) => {
          const row = matrices[i]?.[label] ?? {};
          return { model: c.model as string, correct: row[label] ?? 0, total: Object.values(row).reduce((a, b) => a + b, 0) };
        });
        if (rows.some((r) => r.correct < r.total)) classes.push({ stageKey, label, rows });
      }
    }
    const errorsOf = (rows: Array<{ correct: number; total: number }>): number => Math.max(...rows.map((r) => r.total - r.correct));
    classes.sort((a, b) => errorsOf(b.rows) - errorsOf(a.rows));

    // Por qué fallan: checks fallidos por etapa y modelo.
    const checks: ModelComparison["checks"] = [];
    for (const stageKey of stageKeys) {
      const perStage = group.map((c) => c.records.filter((r) => r.stageKey === stageKey && r.bucket === "canonical"));
      const counts = perStage.map(failedChecks);
      for (const check of new Set(counts.flatMap((m) => [...m.keys()]))) {
        checks.push({
          stageKey,
          check,
          rows: group.map((c, i) => ({ model: c.model as string, failed: counts[i].get(check) ?? 0, total: perStage[i].length })),
        });
      }
    }
    const maxFailed = (rows: Array<{ failed: number }>): number => Math.max(...rows.map((r) => r.failed));
    checks.sort((a, b) => maxFailed(b.rows) - maxFailed(a.rows));

    // Casos donde no todos los modelos obtuvieron lo mismo. Solo cuentan runs comparables (sin falla de cliente).
    const perModel = group.map((c) => {
      const m = new Map<string, RunRecord[]>();
      for (const r of c.records.filter((x) => x.bucket === "canonical" && isComparable(x))) {
        const k = `${r.caseId}\u0000${r.stageKey}`;
        const l = m.get(k) ?? [];
        l.push(r);
        m.set(k, l);
      }
      return m;
    });
    const caseKeys = [...perModel[0].keys()].filter((k) => perModel.every((m) => m.has(k)));
    const disagreements: ModelComparison["disagreements"] = [];
    for (const k of caseKeys) {
      const rates = perModel.map((m) => {
        const l = m.get(k) as RunRecord[];
        return { passed: l.filter((r) => r.passed).length, total: l.length };
      });
      const same = rates.every((r) => r.passed / r.total === rates[0].passed / rates[0].total);
      if (same) continue;
      const [caseId, stageKey] = k.split("\u0000");
      const results: Record<string, string> = {};
      rates.forEach((r, i) => {
        results[models[i]] = r.total === 1 ? (r.passed === 1 ? "pasa" : "falla") : `${r.passed}/${r.total}`;
      });
      disagreements.push({ caseId, stageKey, results });
    }

    out.push({
      variant: first.variantSpec,
      dataset: first.datasetName,
      scope: first.scope ?? "all",
      reference: models[0],
      models,
      noData,
      overall,
      stages,
      questions,
      classes,
      checks,
      comparedCases: caseKeys.length,
      disagreements,
    });
  }
  return out;
}

type SummaryKind = NonNullable<VariantSummary["kind"]>;

const KIND_ORDER: SummaryKind[] = ["generative", "decision", "total"];
const KIND_LABEL: Record<SummaryKind, string> = { generative: "generativo", decision: "decisión", total: "total (mezcla)" };

/** Tipo de modelo que corre una etapa. `stageKey` puede traer sufijo de thinking (`final[think=on]`). */
function kindOfStage(stageOrKey: string): "generative" | "decision" {
  const stage = stageOrKey.replace(/\[.*\]$/, "");
  return (DECISION_STAGES as readonly string[]).includes(stage) ? "decision" : "generative";
}

/**
 * Una fila por (modelo, tipo de etapas, variante). Los tipos (generativo / decisión) se resumen por separado porque
 * los corren modelos distintos: un total mezclado puede esconder que una variante mejora un tipo y empeora el otro.
 * El total solo se agrega cuando hay ambos tipos. Los deltas son contra la baseline del mismo modelo y tipo, sobre los
 * casos medidos en ambos lados; regresiones y mejoras salen de esos mismos pares.
 */
function summarizeVariants(baseline: string, cells: InputCell[]): VariantSummary[] {
  const variants: string[] = [];
  const models: Array<string | undefined> = [];
  for (const c of cells) {
    if (!variants.includes(c.variantSpec)) variants.push(c.variantSpec);
    if (!models.includes(c.model)) models.push(c.model);
  }

  const rows: VariantSummary[] = [];
  for (const model of models) {
    const byVariant = new Map(
      variants.map((v) => [
        v,
        cells
          .filter((c) => c.variantSpec === v && c.model === model)
          .flatMap((c) => c.records.filter((r) => r.bucket === "canonical")),
      ]),
    );
    const present = new Set(
      [...byVariant.values()].flatMap((recs) => recs.map((r) => kindOfStage(r.stage))),
    );
    const kinds = KIND_ORDER.filter((k) => (k === "total" ? present.size > 1 : present.has(k)));

    for (const kind of kinds) {
      const ofKind = (records: RunRecord[]): RunRecord[] =>
        kind === "total" ? records : records.filter((r) => kindOfStage(r.stage) === kind);
      const baseRecords = ofKind(byVariant.get(baseline) ?? []);

      for (const variant of variants) {
        const all = byVariant.get(variant) ?? [];
        if (all.length === 0) continue;
        const canonical = ofKind(all);
        const passedRuns = canonical.filter((r) => r.passed).length;

        const byStage = new Map<string, RunRecord[]>();
        for (const r of canonical) byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r]);
        const stageRates = [...byStage.values()].map((rs) => rs.filter((r) => r.passed).length / rs.length);

        const row: VariantSummary = {
          variant,
          ...(model !== undefined ? { model } : {}),
          kind,
          totalRuns: canonical.length,
          passedRuns,
          passRate: canonical.length > 0 ? passedRuns / canonical.length : 0,
          macroPassRate: stageRates.length > 0 ? mean(stageRates) : 0,
          clientFailedRuns: canonical.filter((r) => r.metrics?.client_call_ok === false).length,
          variantApplyFailedRuns: canonical.filter((r) => r.metrics?.variant_apply_ok === false).length,
          retriedRuns: canonical.filter((r) => Number(r.measurements?.attempts) > 1).length,
          regressions: 0,
          improvements: 0,
          // El total mezcla etapas de decenas de ms con otras de segundos: su mediana solo refleja la proporción entre ambas.
          ...(kind !== "total" ? { p50DurationMs: latencies(canonical).p50 } : {}),
        };

        if (variant !== baseline && baseRecords.length > 0) {
          const { pairs } = pairCases(baseRecords, canonical);
          const paired = pairedSummary(pairs);
          row.regressions = paired.worse;
          row.improvements = paired.better;
          if (paired.signTestP !== undefined) row.signTestP = paired.signTestP;
          if (paired.delta !== undefined) {
            const stages = [...new Set(pairs.map((p) => p.stage))];
            row.deltaPassRate = r3(paired.delta);
            row.deltaMacroPassRate = r3(mean(stages.map((s) => mean(pairs.filter((p) => p.stage === s).map(pairDelta)))));
          }
        }
        rows.push(row);
      }
    }
  }
  return rows;
}

/**
 * Avisa cuando una variante mejora un tipo de etapas y empeora el otro: el total mezclado no sirve para decidir.
 * Va en `warnings`, que se imprime en consola y en el Markdown.
 */
function mixedVerdictWarnings(rows: VariantSummary[]): string[] {
  const EPS = 0.0005;
  const out: string[] = [];
  for (const total of rows.filter((r) => r.kind === "total" && r.deltaPassRate !== undefined)) {
    const delta = (kind: SummaryKind): number | undefined =>
      rows.find((r) => r.variant === total.variant && r.model === total.model && r.kind === kind)?.deltaPassRate;
    const gen = delta("generative");
    const dec = delta("decision");
    if (gen === undefined || dec === undefined) continue;
    if ((gen > EPS && dec < -EPS) || (gen < -EPS && dec > EPS)) {
      out.push(
        `Resultado mixto en \`${total.variant}\`${total.model ? ` {${total.model}}` : ""}: generativo ${fmtDeltaPct(gen)}, ` +
          `decisión ${fmtDeltaPct(dec)}; el total (${fmtDeltaPct(total.deltaPassRate as number)}) mezcla ambos y no es representativo. ` +
          "Decidir con el desglose por tipo.",
      );
    }
  }
  return out;
}

/** Hay filas por modelo: se agrega la columna Modelo. */
const hasModels = (report: ComparisonReport): boolean => report.variants.some((v) => v.model !== undefined);

/** Hay fila `total`: la corrida tiene ambos tipos de etapas y se agrega la columna Tipo. */
const hasKinds = (report: ComparisonReport): boolean => report.variants.some((v) => v.kind === "total");

const hasRetries = (report: ComparisonReport): boolean => report.variants.some((v) => v.retriedRuns > 0);

function variantTableHead(report: ComparisonReport): string[] {
  return [
    ...(hasModels(report) ? ["Modelo"] : []),
    ...(hasKinds(report) ? ["Tipo"] : []),
    "Variante",
    "passRate",
    "Δ vs baseline",
    "Macro por etapa",
    "Regresiones",
    "Mejoras",
    "p (signos)",
    "Sin medir",
    ...(hasRetries(report) ? ["Reintentos"] : []),
    "p50",
  ];
}

function variantTableRows(report: ComparisonReport): string[][] {
  const withModel = hasModels(report);
  const withKind = hasKinds(report);
  const withRetries = hasRetries(report);
  return report.variants.map((v) => {
    const isBase = v.variant === report.baseline;
    const macroDelta = v.deltaMacroPassRate === undefined ? "" : ` (${fmtDeltaPct(v.deltaMacroPassRate)})`;
    return [
      ...(withModel ? [v.model ?? "—"] : []),
      ...(withKind ? [KIND_LABEL[v.kind ?? "total"]] : []),
      isBase ? `${v.variant} (baseline)` : v.variant,
      `${fmtPct(v.passRate)} (${v.passedRuns}/${v.totalRuns})`,
      v.deltaPassRate === undefined ? "—" : fmtDeltaPct(v.deltaPassRate),
      `${fmtPct(v.macroPassRate)}${macroDelta}`,
      isBase ? "—" : String(v.regressions),
      isBase ? "—" : String(v.improvements),
      fmtP(v.signTestP),
      String(v.clientFailedRuns + v.variantApplyFailedRuns),
      ...(withRetries ? [String(v.retriedRuns)] : []),
      fmtMs(v.p50DurationMs),
    ];
  });
}

/** Tabla de una fila por variante, para la consola. */
export function printVariantSummary(report: ComparisonReport): void {
  if (report.variants.length === 0) return;
  const head = variantTableHead(report);
  const rows = [head, ...variantTableRows(report)];
  const widths = head.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  console.log("\n── Resumen por variante ──");
  rows.forEach((r, idx) => {
    console.log("  " + r.map((c, i) => c.padEnd(widths[i])).join("  "));
    if (idx === 0) console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  });
}

const SCOPE_LABEL: Record<ModelComparison["scope"], string> = {
  all: "todas las etapas",
  generative: "etapas generativas",
  decision: "etapas de decisión",
};

function fmtOpt(r: number | undefined, delta = false): string {
  if (r === undefined) return "—";
  return delta ? fmtDeltaPct(r) : fmtPct(r);
}

function fmtMs(n: number | undefined, delta = false): string {
  if (n === undefined) return "—";
  return delta ? fmtDeltaMs(n) : `${n}ms`;
}

/** `†`: con pocas muestras el p95 es el máximo de la muestra (en la práctica, a menudo la carga en frío del modelo). */
function fmtP95(n: number | undefined, samples: number): string {
  return n !== undefined && samples < MIN_P95_SAMPLES ? `${n}ms†` : fmtMs(n);
}

const P95_NOTE = `\`†\` = menos de ${MIN_P95_SAMPLES} muestras: el p95 es el máximo, suele ser la carga en frío del modelo y no se publica su delta.`;
const SIGN_NOTE =
  "`p`: prueba de signos sobre los casos que cambiaron. Un p alto significa que el cambio es compatible con ruido, no que no exista; con menos de 6 casos que cambian nunca baja de 0.05.";

interface ModelColumn {
  head: string;
  cell: (r: ModelRow, isRef: boolean) => string;
  /** Columna que solo tiene sentido en etapas de decisión (la accuracy es la de las decisiones). */
  decisionOnly?: boolean;
  /** Columna que solo tiene sentido en etapas generativas (reintentos por salida inválida). */
  generativeOnly?: boolean;
  /** Se omite en la tabla de consola. */
  mdOnly?: boolean;
}

const MODEL_COLUMNS: ModelColumn[] = [
  { head: "Modelo", cell: (r, ref) => (ref ? `**${r.model}** (ref)` : `**${r.model}**`) },
  { head: "passRate", cell: (r) => `${fmtPct(r.passRate)} (${r.passedRuns}/${r.totalRuns})` },
  { head: "Δ pass", cell: (r, ref) => (ref ? "—" : fmtOpt(r.deltaPassRate, true)) },
  {
    head: "Mejor/peor (p)",
    cell: (r, ref) => (ref || r.casesBetter === undefined ? "—" : `${r.casesBetter}/${r.casesWorse} (${fmtP(r.signTestP)})`),
  },
  { head: "Accuracy", decisionOnly: true, cell: (r) => fmtOpt(r.accuracy) },
  { head: "Δ acc", decisionOnly: true, cell: (r, ref) => (ref ? "—" : fmtOpt(r.deltaAccuracy, true)) },
  { head: "P(correcta)", decisionOnly: true, cell: (r) => (r.calibration ? fmtPct(r.calibration.avgCorrectProb) : "—") },
  { head: "Brier", decisionOnly: true, cell: (r) => (r.calibration ? r.calibration.brier.toFixed(3) : "—") },
  {
    head: "Errores seguros",
    decisionOnly: true,
    mdOnly: true,
    cell: (r) => (r.calibration ? `${r.calibration.confidentErrors}/${r.calibration.errors}` : "—"),
  },
  { head: "p50", cell: (r) => fmtMs(r.p50DurationMs) },
  { head: "Δ p50", cell: (r, ref) => (ref ? "—" : fmtMs(r.deltaP50Ms, true)) },
  { head: "p95", cell: (r) => fmtP95(r.p95DurationMs, r.latencySamples) },
  { head: "Δ p95", cell: (r, ref) => (ref ? "—" : fmtMs(r.deltaP95Ms, true)) },
  { head: "Reintentos", generativeOnly: true, mdOnly: true, cell: (r) => String(r.retriedRuns) },
  {
    head: "Tokens (P/C/T)",
    mdOnly: true,
    cell: (r) => (r.tokens ? `${r.tokensEstimated ? "~" : ""}${r.tokens.avgPrompt}/${r.tokens.avgCompletion}/${r.tokens.avgTotal}` : "—"),
  },
  { head: "Fallas cliente", cell: (r) => String(r.clientFailedRuns) },
];

/** Columnas de la tabla de modelos: las de decisión (accuracy, calibración) y las generativas (reintentos) según el alcance. */
function modelColumns(scope: ModelComparison["scope"], forConsole = false): ModelColumn[] {
  return MODEL_COLUMNS.filter(
    (c) => (scope !== "generative" || !c.decisionOnly) && (scope !== "decision" || !c.generativeOnly) && (!forConsole || !c.mdOnly),
  );
}

function mdTable(head: string[], rows: string[][]): string[] {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
}

function renderModelComparisonMarkdown(report: ComparisonReport): string[] {
  const comps = report.modelComparisons ?? [];
  if (comps.length === 0) return [];
  const lines: string[] = ["## Comparación entre Modelos", ""];
  lines.push(
    "Mismo dataset y variante contra cada modelo. Los deltas son contra el **primer modelo** de la lista (ref). " +
      "Cada modelo corre solo las etapas de su tipo. Una latencia `—` significa que ninguna llamada se completó. " +
      "Δ pass y Δ acc se calculan solo sobre casos medidos en ambos modelos. " +
      "`P(correcta)` = probabilidad media que el modelo da a la opción correcta; `Brier` = error cuadrático medio de las probabilidades (0 = perfecto, menor es mejor); `Errores seguros` = errores con probabilidad ≥ 80 % en la opción equivocada (route, tool_choice y args_review). " +
      P95_NOTE + " " + SIGN_NOTE,
    "",
  );
  for (const c of comps) {
    lines.push(`### \`${c.variant}\` — ${c.dataset} — ${SCOPE_LABEL[c.scope]}`, "");
    for (const m of c.noData) {
      lines.push(
        `> ⚠ \`${m}\`: todas sus llamadas fallaron en el cliente (red/timeout/HTTP). ` +
          "Si es un modelo generativo usado como modelo de decisión (o al revés), el servidor lo rechaza: no hay datos comparables.",
        "",
      );
    }
    const cols = modelColumns(c.scope);
    const head = cols.map((x) => x.head);
    const tableRows = (rows: ModelRow[]): string[][] => rows.map((r, i) => cols.map((x) => x.cell(r, i === 0)));
    lines.push(...mdTable(head, tableRows(c.overall)), "");
    for (const st of c.stages) {
      lines.push(`**\`${st.stageKey}\`**`, "");
      lines.push(...mdTable(head, tableRows(st.rows)), "");
    }
    if (c.questions.length > 0) {
      lines.push("**Accuracy por pregunta**", "");
      const head = ["Etapa", "Pregunta", "Rol", ...c.models.flatMap((m) => [`${m} acc`, `${m} errores`])];
      const rows = c.questions.map((q) => [
        `\`${q.stageKey}\``,
        `\`${q.question}\``,
        q.role === "main" ? "principal" : "extra",
        ...c.models.flatMap((m) => {
          const r = q.rows.find((x) => x.model === m);
          return r ? [`${fmtPct(r.accuracy)} (${r.graded})`, r.fp !== undefined ? `FP ${r.fp} / FN ${r.fn}${r.unanswered > 0 ? ` / sin resp. ${r.unanswered}` : ""}` : String(r.errors)] : ["—", "—"];
        }),
      ]);
      lines.push(...mdTable(head, rows), "");
    }
    if (c.classes.length > 0) {
      lines.push("**Aciertos por clase esperada** (aciertos/casos; solo clases donde algún modelo se equivoca)", "");
      const shown = c.classes.slice(0, 25);
      lines.push(
        ...mdTable(
          ["Etapa", "Clase esperada", ...c.models],
          shown.map((x) => [`\`${x.stageKey}\``, `\`${x.label}\``, ...c.models.map((m) => { const r = x.rows.find((y) => y.model === m); return r ? `${r.correct}/${r.total}` : "—"; })]),
        ),
        "",
      );
      if (c.classes.length > shown.length) lines.push(`… y ${c.classes.length - shown.length} más.`, "");
    }
    if (c.checks.length > 0) {
      lines.push("**Checks fallidos** (runs en que falló cada check; el más fallado primero)", "");
      const shown = c.checks.slice(0, 25);
      lines.push(
        ...mdTable(
          ["Etapa", "Check", ...c.models],
          shown.map((x) => [`\`${x.stageKey}\``, `\`${x.check}\``, ...c.models.map((m) => { const r = x.rows.find((y) => y.model === m); return r ? `${r.failed}/${r.total}` : "—"; })]),
        ),
        "",
      );
      if (c.checks.length > shown.length) lines.push(`… y ${c.checks.length - shown.length} más (ver runs.jsonl).`, "");
    }
    if (c.noData.length > 0) {
      lines.push("No se listan discrepancias por caso: hay modelos sin llamadas exitosas.", "");
    }
    if (c.disagreements.length === 0) {
      if (c.noData.length === 0) lines.push(`Los modelos obtuvieron el mismo resultado en los ${c.comparedCases} casos medidos en todos.`, "");
    } else {
      lines.push(`**Casos donde los modelos discrepan (${c.disagreements.length})**`, "");
      const shown = c.disagreements.slice(0, 40);
      lines.push(
        ...mdTable(["Caso", "Stage", ...c.models], shown.map((d) => [`\`${d.caseId}\``, `\`${d.stageKey}\``, ...c.models.map((m) => d.results[m] ?? "—")])),
        "",
      );
      if (c.disagreements.length > shown.length) lines.push(`… y ${c.disagreements.length - shown.length} más (ver runs.jsonl).`, "");
    }
  }
  return lines;
}

/** Sección de preguntas por etapa: precisión por pregunta, FP/FN por clase y cruces entre preguntas. */
function renderQuestionsMarkdown(report: ComparisonReport, n: number): string[] {
  const withQ = report.cells.filter((c) => c.questions && Object.keys(c.questions).length > 0);
  if (withQ.length === 0) return [];
  const lines: string[] = [
    "",
    `## ${n}. Preguntas por Etapa`,
    "",
    "Etapas de decisión con 2 o más preguntas evaluadas en el mismo request. FP = se predijo la clase y no era; FN = era y no se predijo. En las preguntas sí/no la clase positiva es `yes`.",
    "",
  ];
  for (const c of withQ) {
    lines.push(`### \`${c.variant}\` — ${c.dataset} — \`${c.stageKey}\`${c.model ? ` — ${c.model}` : ""}`, "");
    const qs = Object.entries(c.questions as Record<string, QuestionScore>);
    lines.push(
      ...mdTable(
        ["Pregunta", "Rol", "Accuracy", "Evaluadas", "Sin respuesta"],
        qs.map(([k, q]) => [`\`${k}\``, q.role === "main" ? "principal" : "extra", fmtPct(q.accuracy), String(q.graded), String(q.unanswered)]),
      ),
      "",
    );
    const classRows: string[][] = [];
    for (const [k, q] of qs) {
      for (const [label, cs] of Object.entries(q.perClass)) {
        classRows.push([
          `\`${k}\``,
          `\`${label}\``,
          String(cs.tp),
          String(cs.fp),
          String(cs.fn),
          cs.precision === null ? "—" : fmtPct(cs.precision),
          cs.recall === null ? "—" : fmtPct(cs.recall),
        ]);
      }
    }
    lines.push(...mdTable(["Pregunta", "Clase", "TP", "FP", "FN", "Precisión", "Recall"], classRows), "");
    const cross = c.questionCross ?? [];
    if (cross.length > 0) {
      lines.push("**Cruce entre preguntas** (en cuántos runs acertó cada una)", "");
      lines.push(
        ...mdTable(
          ["A", "B", "Runs", "Ambas bien", "Solo A", "Solo B", "Ambas mal"],
          cross.map((x) => [`\`${x.a}\``, `\`${x.b}\``, String(x.runs), String(x.bothCorrect), String(x.onlyA), String(x.onlyB), String(x.bothWrong)]),
        ),
        "",
      );
    }
  }
  return lines;
}

/**
 * Resumen por etapa con las variantes lado a lado: una fila por (dataset, modelo, etapa) y una columna por variante en cada
 * métrica. En las variantes que no son la baseline, el delta contra la baseline va entre paréntesis.
 */
function renderStageTable(report: ComparisonReport): string[] {
  const variants = [...new Set(report.cells.map((c) => c.variant))];
  const rowKey = (c: CellStageReport): string => `${c.dataset}\u0000${c.model ?? ""}\u0000${c.stageKey}`;
  const rows = new Map<string, Map<string, CellStageReport>>();
  for (const c of report.cells) {
    const m = rows.get(rowKey(c)) ?? new Map<string, CellStageReport>();
    m.set(c.variant, c);
    rows.set(rowKey(c), m);
  }
  const withModel = report.cells.some((c) => c.model !== undefined);
  const hasAcc = report.cells.some((c) => c.accuracy !== undefined);
  const hasTokens = report.cells.some((c) => c.tokens !== undefined);
  // passAll solo agrega información con repeticiones: con una sola, es lo mismo que passRate.
  const hasRepeats = report.cells.some((c) => c.totalRuns > c.cases);
  const deltaKey = (variant: string, c: { dataset: string; model?: string; stageKey: string }): string =>
    `${variant}\u0000${c.dataset}\u0000${c.model ?? ""}\u0000${c.stageKey}`;
  const deltas = new Map(report.deltas.map((d) => [deltaKey(d.variant, d), d]));

  interface StageMetric {
    head: string;
    show: boolean;
    value: (c: CellStageReport) => string;
    delta?: (d: ComparisonDelta) => string;
  }
  const allMetrics: StageMetric[] = [
    {
      head: "passRate",
      show: true,
      value: (c) => (c.totalRuns > 0 ? `${fmtPct(c.passRate)} (${c.passedRuns}/${c.totalRuns})` : "—"),
      delta: (d) => fmtDeltaPct(d.deltaPassRate),
    },
    {
      head: "passAll",
      show: hasRepeats,
      value: (c) => (c.totalRuns > 0 ? fmtPct(c.passAllRate) : "—"),
    },
    {
      head: "Accuracy",
      show: hasAcc,
      value: (c) => (c.accuracy !== undefined ? fmtPct(c.accuracy) : "—"),
      delta: (d) => (d.deltaAccuracy !== undefined ? fmtDeltaPct(d.deltaAccuracy) : ""),
    },
    { head: "p50", show: true, value: (c) => fmtMs(c.p50DurationMs), delta: (d) => (d.deltaP50Ms !== undefined ? fmtDeltaMs(d.deltaP50Ms) : "") },
    {
      head: "p95",
      show: true,
      value: (c) => fmtP95(c.p95DurationMs, c.latencySamples),
      delta: (d) => (d.deltaP95Ms !== undefined ? fmtDeltaMs(d.deltaP95Ms) : ""),
    },
    {
      head: "Tokens (total)",
      show: hasTokens,
      value: (c) => (c.tokens ? `${c.tokensEstimated ? "~" : ""}${c.tokens.avgTotal}` : "—"),
    },
  ];
  const metrics = allMetrics.filter((m) => m.show);

  const head = [
    "Dataset",
    ...(withModel ? ["Modelo"] : []),
    "Stage",
    ...metrics.flatMap((m) => variants.map((v) => `${m.head} \`${v}\`${v === report.baseline ? " (base)" : ""}`)),
  ];
  const lines = ["## 1. Resumen por Etapa", ""];
  const body: string[][] = [];
  for (const m of rows.values()) {
    const any = [...m.values()][0];
    body.push([
      any.dataset,
      ...(withModel ? [any.model ?? "—"] : []),
      `\`${any.stageKey}\``,
      ...metrics.flatMap((metric) =>
        variants.map((v) => {
          const c = m.get(v);
          if (!c) return "—";
          const text = metric.value(c);
          const delta = deltas.get(deltaKey(v, c));
          const d = delta && metric.delta ? metric.delta(delta) : "";
          return d ? `${text} **(${d})**` : text;
        }),
      ),
    ]);
  }
  lines.push(...mdTable(head, body), "");
  lines.push(
    "Entre paréntesis, el delta contra la baseline" +
      (report.cells.some((c) => c.variant === report.baseline) ? ", solo sobre casos medidos en ambos lados." : " (la baseline no se ejecutó: sin deltas)."),
    "`final[think=on]` y `final[think=off]` son el mismo caso corrido dos veces: ambos suman en los totales. En \"Macro por etapa\" cuentan como una sola etapa.",
    P95_NOTE,
  );
  if (report.cells.some((c) => c.tokensEstimated)) lines.push("`~` = tokens estimados (caracteres/3), no medidos por el modelo.");
  lines.push("");
  return lines;
}

/** Bucket raw (adversariales, prod_shortcut): no suma en passRate, pero sus resultados y cambios tienen que verse. */
function renderRawMarkdown(report: ComparisonReport, n: number): string[] {
  const cells = report.cells.filter((c) => c.rawTotalRuns > 0);
  if (cells.length === 0) return [];
  const lines = ["", `## ${n}. Casos raw (fuera de passRate)`, ""];
  lines.push(
    ...mdTable(
      ["Variante", "Modelo", "Dataset", "Stage", "Raw"],
      cells.map((c) => [
        `\`${c.variant}\``,
        c.model ?? "—",
        c.dataset,
        `\`${c.stageKey}\``,
        `${fmtPct(c.rawPassedRuns / c.rawTotalRuns)} (${c.rawPassedRuns}/${c.rawTotalRuns})`,
      ]),
    ),
    "",
  );
  const changes = [
    ...report.rawRegressions.map((x) => ({ ...x, kind: "regresión" })),
    ...report.rawImprovements.map((x) => ({ ...x, kind: "mejora" })),
  ];
  if (changes.length > 0) {
    lines.push(
      ...mdTable(
        ["Cambio", "Variante", "Modelo", "Dataset", "Caso", "Stage", "Detalle"],
        changes.map((x) => [x.kind, `\`${x.variant}\``, x.model ?? "—", x.dataset, `\`${x.caseId}\``, `\`${x.stageKey}\``, x.diff]),
      ),
      "",
    );
  }
  return lines;
}

export function renderComparisonMarkdown(report: ComparisonReport): string {
  const lines: string[] = [
    "# Reporte de Comparación",
    "",
    `**Baseline:** \`${report.baseline}\``,
    "",
    ...(report.warnings ?? []).flatMap((w) => [`> ⚠ ${w}`, ""]),
    "## Resumen por Variante",
    "",
    `| ${variantTableHead(report).join(" | ")} |`,
    `|${variantTableHead(report).map(() => "---").join("|")}|`,
    ...variantTableRows(report).map((r) => `| ${r.join(" | ")} |`),
    "",
    "Agregado sobre todos los datasets, por tipo de etapas (generativo / decisión). **Sin medir** = llamadas fallidas (red, timeout, HTTP) o variante no aplicada: cuentan como falla en passRate, pero Δ, regresiones y mejoras comparan solo casos medidos en ambos lados. **Macro por etapa** pesa cada etapa por igual (en passRate pesan según su cantidad de casos).",
    SIGN_NOTE,
    "",
    ...renderModelComparisonMarkdown(report),
    ...renderStageTable(report),
  ];

  lines.push("", "## 2. Regresiones");
  if (report.regressions.length === 0) {
    lines.push("", "Sin regresiones.");
  } else {
    lines.push(
      "",
      "| Variante | Modelo | Dataset | Caso | Stage | Baseline | Variante | Cambio |",
      "|---|---|---|---|---|---|---|---|",
    );
    for (const r of report.regressions) {
      lines.push(
        `| \`${r.variant}\` | ${r.model ?? "—"} | ${r.dataset} | \`${r.caseId}\` | \`${r.stageKey}\` | ${r.baseline} | ${r.variantResult} | ${r.diff} |`,
      );
    }
  }

  lines.push("", "## 3. Mejoras");
  if (report.improvements.length === 0) {
    lines.push("", "Sin mejoras.");
  } else {
    lines.push(
      "",
      "| Variante | Modelo | Dataset | Caso | Stage | Baseline | Variante | Cambio |",
      "|---|---|---|---|---|---|---|---|",
    );
    for (const im of report.improvements) {
      lines.push(
        `| \`${im.variant}\` | ${im.model ?? "—"} | ${im.dataset} | \`${im.caseId}\` | \`${im.stageKey}\` | ${im.baseline} | ${im.variantResult} | ${im.diff} |`,
      );
    }
  }

  let section = 4;
  const rawLines = renderRawMarkdown(report, section);
  if (rawLines.length > 0) section++;
  lines.push(...rawLines);

  // Matrices de confusión
  const withConfusion = report.cells.filter((c) => c.confusionMatrix !== undefined);
  if (withConfusion.length > 0) {
    lines.push("", `## ${section++}. Matrices de Confusión`, "");
    for (const c of withConfusion) {
      lines.push(`### \`${c.variant}\` — ${c.dataset} — \`${c.stageKey}\`${c.model ? ` — ${c.model}` : ""}`, "");
      const matrix = c.confusionMatrix!;
      const expectedKeys = Object.keys(matrix).sort();
      const predictedKeys = Array.from(
        new Set(expectedKeys.flatMap((k) => Object.keys(matrix[k]))),
      ).sort();

      lines.push(
        `| Esperado \\ Predicho | ${predictedKeys.join(" | ")} |`,
        `|---|${predictedKeys.map(() => "---").join("|")}|`,
      );

      for (const exp of expectedKeys) {
        const row = predictedKeys.map((pred) => matrix[exp]?.[pred] ?? 0);
        lines.push(`| **${exp}** | ${row.join(" | ")} |`);
      }
      lines.push("");
    }
  }

  lines.push(...renderQuestionsMarkdown(report, section));

  return lines.join("\n") + "\n";
}

/**
 * Imprime un resumen de comparación legible en consola.
 */
/** Comparación directa entre modelos en consola: una tabla por grupo, y accuracy por pregunta. */
export function printModelComparison(report: ComparisonReport): void {
  for (const c of report.modelComparisons ?? []) {
    console.log(`\n── Comparación entre modelos: ${c.variant} / ${c.dataset} (${SCOPE_LABEL[c.scope]}) ──`);
    for (const m of c.noData) console.log(`  ⚠ ${m}: todas sus llamadas fallaron en el cliente; sin datos comparables.`);
    const cols = modelColumns(c.scope, true);
    const head = cols.map((x) => x.head);
    const cell = (r: ModelRow, i: number): string[] => cols.map((x) => x.cell(r, i === 0).replace(/\*\*/g, ""));
    const rows = [head, ...c.overall.map(cell)];
    const widths = head.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
    rows.forEach((r, idx) => {
      console.log("  " + r.map((v, i) => v.padEnd(widths[i])).join("  "));
      if (idx === 0) console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
    });
    for (const st of c.stages) {
      const parts = st.rows.map((r, i) => {
        const d = i === 0 || r.deltaPassRate === undefined ? "" : ` (${fmtDeltaPct(r.deltaPassRate)})`;
        const acc = c.scope !== "generative" && r.accuracy !== undefined ? ` acc ${fmtPct(r.accuracy)}` : "";
        return `${r.model} ${fmtPct(r.passRate)}${d}${acc} p50 ${fmtMs(r.p50DurationMs)}`;
      });
      console.log(`  [${st.stageKey}] ${parts.join("  |  ")}`);
    }
    for (const q of c.questions) {
      const parts = q.rows.map(
        (r) => `${r.model} ${fmtPct(r.accuracy)} (${errorSummary(r, r.fp !== undefined ? { fp: r.fp, fn: r.fn as number } : undefined)})`,
      );
      console.log(`  [${q.stageKey}] pregunta ${q.question}${q.role === "main" ? " (principal)" : ""}: ${parts.join("  |  ")}`);
    }
    const modelsText = (rows: Array<{ model: string }>, fmt: (r: never) => string): string =>
      rows.map((r) => `${r.model} ${fmt(r as never)}`).join("  |  ");
    for (const x of c.classes.slice(0, 10)) {
      console.log(`  [${x.stageKey}] clase ${x.label}: ${modelsText(x.rows, (r: { correct: number; total: number }) => `${r.correct}/${r.total}`)}`);
    }
    if (c.classes.length > 10) console.log(`  … ${c.classes.length - 10} clase(s) más (ver comparison.md).`);
    for (const x of c.checks.slice(0, 10)) {
      console.log(`  [${x.stageKey}] check ${x.check} falló: ${modelsText(x.rows, (r: { failed: number; total: number }) => `${r.failed}/${r.total}`)}`);
    }
    if (c.checks.length > 10) console.log(`  … ${c.checks.length - 10} check(s) más (ver comparison.md).`);
    if (c.disagreements.length > 0) console.log(`  ${c.disagreements.length} caso(s) donde los modelos discrepan (ver comparison.md).`);
  }
}

/**
 * Resumen por etapa en consola: por cada (dataset, modelo, etapa), una línea por variante con su pass rate, accuracy y p50, y
 * el delta contra la baseline. Es lo mismo que la tabla por etapa de comparison.md, en un formato que entra en la terminal.
 */
export function printStageSummary(report: ComparisonReport): void {
  if (report.cells.length === 0) return;
  const key = (variant: string, c: { dataset: string; model?: string; stageKey: string }): string =>
    `${variant}\u0000${c.dataset}\u0000${c.model ?? ""}\u0000${c.stageKey}`;
  const deltas = new Map(report.deltas.map((d) => [key(d.variant, d), d]));
  const groups = new Map<string, CellStageReport[]>();
  for (const c of report.cells) {
    const k = `${c.dataset}\u0000${c.model ?? ""}\u0000${c.stageKey}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const labelOf = (c: CellStageReport): string => (c.variant === report.baseline ? `${c.variant} (base)` : c.variant);
  const nameW = Math.max(...report.cells.map((c) => labelOf(c).length));
  console.log("\n── Resumen por etapa ──");
  for (const cells of groups.values()) {
    const f = cells[0];
    console.log(`  ${f.dataset}${f.model ? ` {${f.model}}` : ""} · ${f.stageKey}`);
    for (const c of cells) {
      const d = deltas.get(key(c.variant, c));
      const pass = c.totalRuns > 0 ? `${fmtPct(c.passRate)} (${c.passedRuns}/${c.totalRuns})` : "—";
      const acc = c.accuracy !== undefined ? `acc ${fmtPct(c.accuracy)}` : "";
      const delta = d ? `Δ pass ${fmtDeltaPct(d.deltaPassRate)}${d.deltaAccuracy !== undefined ? `, Δ acc ${fmtDeltaPct(d.deltaAccuracy)}` : ""}` : "";
      console.log(`    ${labelOf(c).padEnd(nameW)}  ${pass.padEnd(15)}  ${acc.padEnd(10)}  p50 ${fmtMs(c.p50DurationMs).padEnd(8)}  ${delta}`.trimEnd());
    }
  }
}

/** Una línea por pregunta de las etapas con varias preguntas: accuracy y FP/FN totales. */
export function printQuestionSummary(report: ComparisonReport): void {
  const withQ = report.cells.filter((c) => c.questions && Object.keys(c.questions).length > 0);
  if (withQ.length === 0) return;
  console.log("\n── Preguntas por etapa ──");
  for (const c of withQ) {
    console.log(`  ${c.variant}${c.model ? ` [${c.model}]` : ""} ${c.dataset}/${c.stageKey}`);
    for (const [k, q] of Object.entries(c.questions as Record<string, QuestionScore>)) {
      console.log(
        `    ${k.padEnd(14)} ${fmtPct(q.accuracy).padStart(6)} (${q.correct}/${q.graded})  ${errorSummary({ errors: q.graded - q.correct, unanswered: q.unanswered }, yesNoFpFn(q))}${q.role === "main" ? "  [principal]" : ""}`,
      );
    }
    for (const x of c.questionCross ?? []) {
      console.log(`    ${x.a} × ${x.b}: ambas bien ${x.bothCorrect}, solo ${x.a} ${x.onlyA}, solo ${x.b} ${x.onlyB}, ambas mal ${x.bothWrong}`);
    }
  }
}

export function printComparisonSummary(report: ComparisonReport): void {
  const warnings = report.warnings ?? [];
  if (
    report.deltas.length === 0 &&
    report.regressions.length === 0 &&
    report.improvements.length === 0 &&
    report.rawRegressions.length === 0 &&
    report.rawImprovements.length === 0 &&
    warnings.length === 0
  ) {
    return;
  }

  console.log("\n── Comparación vs Baseline (`" + report.baseline + "`) ──");
  for (const w of warnings) console.log(`  ⚠ ${w}`);

  if (report.deltas.length > 0) {
    for (const d of report.deltas) {
      const deltaAccStr = d.deltaAccuracy !== undefined ? ` | Δ acc: ${fmtDeltaPct(d.deltaAccuracy)}` : "";
      console.log(
        `  ${d.variant}${d.model ? ` {${d.model}}` : ""} [${d.dataset}/${d.stageKey}]: Δ pass: ${fmtDeltaPct(d.deltaPassRate)}${deltaAccStr} | Δ p50: ${fmtMs(d.deltaP50Ms, true)}`,
      );
    }
  }

  if (report.regressions.length > 0) {
    console.log(`\n  ⚠ Regresiones (${report.regressions.length}):`);
    for (const r of report.regressions) {
      console.log(`    - ${r.caseId} [${r.stageKey}] (${r.variant}${r.model ? `, ${r.model}` : ""}): ${r.diff}`);
    }
  }

  if (report.improvements.length > 0) {
    console.log(`\n  ★ Mejoras (${report.improvements.length}):`);
    for (const im of report.improvements) {
      console.log(`    + ${im.caseId} [${im.stageKey}] (${im.variant}${im.model ? `, ${im.model}` : ""}): ${im.diff}`);
    }
  }

  if (report.rawRegressions.length > 0) {
    console.log(`\n  ⚠ Regresiones en casos raw (${report.rawRegressions.length}, fuera de passRate):`);
    for (const r of report.rawRegressions) {
      console.log(`    - ${r.caseId} [${r.stageKey}] (${r.variant}${r.model ? `, ${r.model}` : ""}): ${r.diff}`);
    }
  }

  if (report.rawImprovements.length > 0) {
    console.log(`\n  ★ Mejoras en casos raw (${report.rawImprovements.length}, fuera de passRate):`);
    for (const im of report.rawImprovements) {
      console.log(`    + ${im.caseId} [${im.stageKey}] (${im.variant}${im.model ? `, ${im.model}` : ""}): ${im.diff}`);
    }
  }
}

/**
 * Escribe comparison.json y comparison.md en el directorio raíz de la corrida.
 */
export function writeComparison(rootDir: string, report: ComparisonReport): void {
  const jsonPath = resolve(`${rootDir}/comparison.json`);
  const mdPath = resolve(`${rootDir}/comparison.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(mdPath, renderComparisonMarkdown(report), "utf8");
}