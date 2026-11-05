/**
 * eval/prompts/core/report.ts
 *
 * Genera comparison.json y comparison.md, y el resumen en consola.
 * Sección 9 del plan de implementación.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NO_PREDICTION } from "./scoring.ts";
import type { GlobalScoreSummary, QuestionCross, QuestionScore, RunRecord } from "./types.ts";

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
  p50DurationMs: number;
  p95DurationMs: number;
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
  deltaPassRate: number;
  deltaAccuracy?: number;
  deltaP50Ms: number;
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
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  /** Diferencia de passRate contra la baseline (undefined si es la baseline o no corrió). */
  deltaPassRate?: number;
  /** Runs cuya llamada al cliente falló: cuentan como falla en passRate. */
  clientFailedRuns: number;
  regressions: number;
  improvements: number;
  /** Mediana de latencia de los runs con llamada exitosa. */
  p50DurationMs: number;
}

/** Una fila de la comparación directa entre modelos. Los deltas son contra el primer modelo de la lista. */
export interface ModelRow {
  model: string;
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  accuracy?: number;
  p50DurationMs: number;
  p95DurationMs: number;
  clientFailedRuns: number;
  tokens?: { avgPrompt: number; avgCompletion: number; avgTotal: number };
  tokensEstimated?: boolean;
  deltaPassRate?: number;
  deltaAccuracy?: number;
  deltaP50Ms?: number;
  deltaP95Ms?: number;
}

export interface ModelComparison {
  variant: string;
  dataset: string;
  scope: "generative" | "decision" | "all";
  /** Modelo contra el que se calculan los deltas (el primero que corrió). */
  reference: string;
  models: string[];
  overall: ModelRow[];
  stages: Array<{ stageKey: string; rows: ModelRow[] }>;
  /** Accuracy por pregunta y modelo (etapas de decisión con varias preguntas). */
  questions: Array<{
    stageKey: string;
    question: string;
    role: "main" | "extra";
    /** `fp` y `fn` solo en preguntas sí/no (clase positiva "yes"); en las demás, ver las tablas por clase. */
    rows: Array<{ model: string; accuracy: number; graded: number; errors: number; fp?: number; fn?: number }>;
  }>;
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
  /** Comparación directa entre modelos (vacío si la corrida usó un solo modelo por tipo de etapa). */
  modelComparisons: ModelComparison[];
  /** Avisos que condicionan cómo leer el reporte (baseline ausente, concurrencia, ...). */
  warnings: string[];
}

/**
 * Un run cuya llamada al cliente falló (red, timeout, HTTP) no dice nada sobre el prompt:
 * no debe aparecer como regresión ni como mejora.
 */
function isComparable(r: RunRecord): boolean {
  return r.metrics?.client_call_ok !== false;
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

      cellReports.push({
        variant: cell.variantSpec,
        dataset: cell.datasetName,
        ...(cell.model !== undefined ? { model: cell.model } : {}),
        stageKey,
        totalRuns: stageSummary.totalRuns,
        passedRuns: stageSummary.passedRuns,
        passRate: stageSummary.passRate,
        passAllRate: stageSummary.passAllRate,
        p50DurationMs: stageSummary.p50DurationMs,
        p95DurationMs: stageSummary.p95DurationMs,
        ...(tokens ? { tokens } : {}),
        ...(tokens && tokensEstimated ? { tokensEstimated: true } : {}),
        ...(stageSummary.accuracy !== undefined ? { accuracy: stageSummary.accuracy } : {}),
        ...(stageSummary.confusionMatrix ? { confusionMatrix: stageSummary.confusionMatrix } : {}),
        ...(stageSummary.questions ? { questions: stageSummary.questions } : {}),
        ...(stageSummary.questionCross ? { questionCross: stageSummary.questionCross } : {}),
      });
    }
  }

  // 2. Calcular Deltas contra la baseline
  const deltas: ComparisonDelta[] = [];
  const regressions: CaseComparison[] = [];
  const improvements: CaseComparison[] = [];

  // La baseline se empareja por dataset Y modelo: con varios modelos, cada uno se compara contra sí mismo.
  const cellKey = (c: { datasetName: string; model?: string }) => `${c.datasetName}\u0000${modelKey(c.model)}`;
  // Mapa de baseline: dataset+modelo -> Map<stageKey, CellStageReport>
  const baselineStageMap = new Map<string, Map<string, CellStageReport>>();
  // Mapa de baseline runs: dataset+modelo -> Map<caseId + "::" + stageKey, RunRecord[]>
  const baselineRunsMap = new Map<string, Map<string, RunRecord[]>>();

  for (const cell of cells) {
    if (cell.variantSpec === baseline) {
      const stageMap = new Map<string, CellStageReport>();
      for (const rep of cellReports.filter(
        (c) => c.variant === baseline && c.dataset === cell.datasetName && modelKey(c.model) === modelKey(cell.model),
      )) {
        stageMap.set(rep.stageKey, rep);
      }
      baselineStageMap.set(cellKey(cell), stageMap);

      const runsMap = new Map<string, RunRecord[]>();
      for (const r of cell.records.filter((rec) => rec.bucket === "canonical" && isComparable(rec))) {
        const key = `${r.caseId}::${r.stageKey}`;
        const list = runsMap.get(key) ?? [];
        list.push(r);
        runsMap.set(key, list);
      }
      baselineRunsMap.set(cellKey(cell), runsMap);
    }
  }

  // Comparar variantes contra baseline
  for (const cell of cells) {
    if (cell.variantSpec === baseline) continue;

    const baseStages = baselineStageMap.get(cellKey(cell));
    const baseRuns = baselineRunsMap.get(cellKey(cell));
    if (!baseStages || !baseRuns) continue;

    // Deltas por stageKey
    const varStages = cellReports.filter(
      (c) => c.variant === cell.variantSpec && c.dataset === cell.datasetName && modelKey(c.model) === modelKey(cell.model),
    );
    for (const vStage of varStages) {
      const bStage = baseStages.get(vStage.stageKey);
      if (!bStage) continue;

      const deltaPassRate = Math.round((vStage.passRate - bStage.passRate) * 1000) / 1000;
      const deltaP50Ms = vStage.p50DurationMs - bStage.p50DurationMs;
      let deltaAccuracy: number | undefined;
      if (vStage.accuracy !== undefined && bStage.accuracy !== undefined) {
        deltaAccuracy = Math.round((vStage.accuracy - bStage.accuracy) * 1000) / 1000;
      }

      deltas.push({
        variant: cell.variantSpec,
        dataset: cell.datasetName,
        ...(cell.model !== undefined ? { model: cell.model } : {}),
        stageKey: vStage.stageKey,
        deltaPassRate,
        deltaP50Ms,
        ...(deltaAccuracy !== undefined ? { deltaAccuracy } : {}),
      });
    }

    // Regresiones y Mejoras por (caseId, stageKey)
    const varRunsMap = new Map<string, RunRecord[]>();
    for (const r of cell.records.filter((rec) => rec.bucket === "canonical" && isComparable(rec))) {
      const key = `${r.caseId}::${r.stageKey}`;
      const list = varRunsMap.get(key) ?? [];
      list.push(r);
      varRunsMap.set(key, list);
    }

    for (const [key, vList] of varRunsMap.entries()) {
      const bList = baseRuns.get(key);
      if (!bList || bList.length === 0 || vList.length === 0) continue;

      const bPassed = bList.filter((r) => r.passed).length;
      const bTotal = bList.length;
      const bRate = bPassed / bTotal;

      const vPassed = vList.filter((r) => r.passed).length;
      const vTotal = vList.length;
      const vRate = vPassed / vTotal;

      // stageKey nunca contiene "::"; caseId sí podría.
      const sep = key.lastIndexOf("::");
      const caseId = key.slice(0, sep);
      const stageKey = key.slice(sep + 2);

      let baselineStr: string;
      let variantStr: string;

      if (bTotal === 1 && vTotal === 1) {
        baselineStr = bPassed === 1 ? "pasa" : "falla";
        variantStr = vPassed === 1 ? "pasa" : "falla";
      } else {
        baselineStr = `${bPassed}/${bTotal}`;
        variantStr = `${vPassed}/${vTotal}`;
      }

      const diff = `${baselineStr} -> ${variantStr}`;

      if (vRate < bRate) {
        regressions.push({
          variant: cell.variantSpec,
          dataset: cell.datasetName,
          ...(cell.model !== undefined ? { model: cell.model } : {}),
          caseId,
          stageKey,
          baseline: baselineStr,
          variantResult: variantStr,
          diff,
        });
      } else if (vRate > bRate) {
        improvements.push({
          variant: cell.variantSpec,
          dataset: cell.datasetName,
          ...(cell.model !== undefined ? { model: cell.model } : {}),
          caseId,
          stageKey,
          baseline: baselineStr,
          variantResult: variantStr,
          diff,
        });
      }
    }
  }

  const warnings: string[] = [];
  const hasBaseline = cells.some((c) => c.variantSpec === baseline);
  const hasOthers = cells.some((c) => c.variantSpec !== baseline);
  if (hasOthers && !hasBaseline) {
    warnings.push(
      `La baseline \`${baseline}\` no se ejecutó: no hay deltas, regresiones ni mejoras (la ausencia no implica que no haya cambios).`,
    );
  }
  if ((opts.concurrency ?? 1) > 1 && (deltas.length > 0 || cells.some((c) => c.model !== undefined))) {
    warnings.push(
      `Concurrencia ${opts.concurrency}: las latencias (p50/p95 y Δ p50) pueden incluir espera en el servidor y no son comparables entre variantes; usar --concurrency=1 para medir latencia.`,
    );
  }

  return {
    baseline,
    variants: summarizeVariants(baseline, cells, regressions, improvements),
    cells: cellReports,
    deltas,
    regressions,
    improvements,
    modelComparisons: compareModels(cells),
    warnings,
  };
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/** FP/FN de una pregunta sí/no (positiva = "yes"). undefined si la pregunta tiene otras clases. */
function yesNoFpFn(q: QuestionScore): { fp: number; fn: number } | undefined {
  const keys = Object.keys(q.perClass);
  if (keys.length === 0 || !keys.every((k) => k === "yes" || k === "no")) return undefined;
  const yes = q.perClass["yes"];
  return { fp: yes?.fp ?? 0, fn: yes?.fn ?? 0 };
}

/** "FP 1, FN 2" para preguntas sí/no; "errores N" para el resto. */
function errorSummary(q: { graded: number; correct: number }, fpfn: { fp: number; fn: number } | undefined): string {
  return fpfn ? `FP ${fpfn.fp}, FN ${fpfn.fn}` : `errores ${q.graded - q.correct}`;
}

/** Fila de modelo para un conjunto de celdas ya filtradas (una celda de un modelo o una etapa de ella). */
function modelRow(model: string, records: RunRecord[]): ModelRow {
  const canonical = records.filter((r) => r.bucket === "canonical");
  // Misma regla que scoring: una decisión sin predicción cuenta como error.
  const decided = canonical.filter((r) => r.expectedLabel);
  const accuracy =
    decided.length > 0
      ? r3(decided.filter((r) => r.expectedLabel === (r.predictedLabel || NO_PREDICTION)).length / decided.length)
      : undefined;
  const durations = canonical
    .filter((r) => r.metrics?.client_call_ok === true)
    .map((r) => r.durationMs)
    .sort((a, b) => a - b);
  const passedRuns = canonical.filter((r) => r.passed).length;
  const tokens = computeAvgTokens(canonical);
  return {
    model,
    totalRuns: canonical.length,
    passedRuns,
    passRate: canonical.length > 0 ? passedRuns / canonical.length : 0,
    ...(accuracy !== undefined ? { accuracy } : {}),
    p50DurationMs: durations.length > 0 ? durations[Math.floor((durations.length - 1) / 2)] : 0,
    p95DurationMs: durations.length > 0 ? durations[Math.max(0, Math.ceil(0.95 * durations.length) - 1)] : 0,
    clientFailedRuns: canonical.filter((r) => r.metrics?.client_call_ok === false).length,
    ...(tokens ? { tokens } : {}),
    ...(tokens && canonical.some((r) => r.tokensEstimated === true) ? { tokensEstimated: true } : {}),
  };
}

/** Rellena los deltas de cada fila contra la primera (el modelo de referencia). */
function fillDeltas(rows: ModelRow[]): void {
  const ref = rows[0];
  if (!ref) return;
  for (const row of rows.slice(1)) {
    if (ref.totalRuns > 0 && row.totalRuns > 0) row.deltaPassRate = r3(row.passRate - ref.passRate);
    if (ref.accuracy !== undefined && row.accuracy !== undefined) row.deltaAccuracy = r3(row.accuracy - ref.accuracy);
    row.deltaP50Ms = row.p50DurationMs - ref.p50DurationMs;
    row.deltaP95Ms = row.p95DurationMs - ref.p95DurationMs;
  }
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
    fillDeltas(overall);

    const stageKeys = [...new Set(group.flatMap((c) => Object.keys(c.scores.stages)))];
    const stages = stageKeys.map((stageKey) => {
      const rows = group.map((c) => {
        return modelRow(c.model as string, c.records.filter((r) => r.stageKey === stageKey));
      });
      fillDeltas(rows);
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
            ...yesNoFpFn(q),
          });
        }
        if (rows.length > 0) questions.push({ stageKey, question, role, rows });
      }
    }

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
      overall,
      stages,
      questions,
      disagreements,
    });
  }
  return out;
}

/**
 * Renderiza el reporte a Markdown.
 */
function summarizeVariants(
  baseline: string,
  cells: InputCell[],
  regressions: CaseComparison[],
  improvements: CaseComparison[],
): VariantSummary[] {
  // Una fila por (variante, modelo); sin comparación de modelos el modelo es undefined y queda una por variante.
  const order: Array<{ variant: string; model: string | undefined }> = [];
  for (const c of cells) {
    if (!order.some((o) => o.variant === c.variantSpec && o.model === c.model)) {
      order.push({ variant: c.variantSpec, model: c.model });
    }
  }

  const rows: VariantSummary[] = order.map(({ variant, model }) => {
    const mine = cells.filter((c) => c.variantSpec === variant && c.model === model);
    const canonical = mine.flatMap((c) => c.records.filter((r) => r.bucket === "canonical"));
    const totalRuns = canonical.length;
    const passedRuns = canonical.filter((r) => r.passed).length;
    const durations = canonical
      .filter((r) => r.metrics?.client_call_ok === true)
      .map((r) => r.durationMs)
      .sort((a, b) => a - b);
    return {
      variant,
      ...(model !== undefined ? { model } : {}),
      totalRuns,
      passedRuns,
      passRate: totalRuns > 0 ? passedRuns / totalRuns : 0,
      clientFailedRuns: canonical.filter((r) => r.metrics?.client_call_ok === false).length,
      regressions: regressions.filter((r) => r.variant === variant && r.model === model).length,
      improvements: improvements.filter((r) => r.variant === variant && r.model === model).length,
      p50DurationMs: durations.length > 0 ? durations[Math.floor((durations.length - 1) / 2)] : 0,
    };
  });

  for (const base of rows.filter((r) => r.variant === baseline)) {
    if (base.totalRuns === 0) continue;
    for (const r of rows) {
      if (r !== base && r.model === base.model && r.totalRuns > 0) r.deltaPassRate = r.passRate - base.passRate;
    }
  }
  return rows;
}

/** Hay filas por modelo: se agrega la columna Modelo. */
const hasModels = (report: ComparisonReport): boolean => report.variants.some((v) => v.model !== undefined);

function variantTableHead(report: ComparisonReport): string[] {
  return hasModels(report) ? ["Modelo", ...VARIANT_TABLE_HEAD] : VARIANT_TABLE_HEAD;
}

function variantTableRows(report: ComparisonReport): string[][] {
  const withModel = hasModels(report);
  return report.variants.map((v) => [
    ...(withModel ? [v.model ?? "—"] : []),
    v.variant === report.baseline ? `${v.variant} (baseline)` : v.variant,
    `${fmtPct(v.passRate)} (${v.passedRuns}/${v.totalRuns})`,
    v.deltaPassRate === undefined ? "—" : fmtDeltaPct(v.deltaPassRate),
    String(v.regressions),
    String(v.improvements),
    String(v.clientFailedRuns),
    `${v.p50DurationMs}ms`,
  ]);
}

const VARIANT_TABLE_HEAD = ["Variante", "passRate", "Δ vs baseline", "Regresiones", "Mejoras", "Fallas cliente", "p50"];

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

function modelRowCells(r: ModelRow, isRef: boolean): string[] {
  const tok = r.tokens ? `${r.tokensEstimated ? "~" : ""}${r.tokens.avgPrompt}/${r.tokens.avgCompletion}/${r.tokens.avgTotal}` : "—";
  return [
    isRef ? `**${r.model}** (ref)` : `**${r.model}**`,
    `${fmtPct(r.passRate)} (${r.passedRuns}/${r.totalRuns})`,
    isRef ? "—" : fmtOpt(r.deltaPassRate, true),
    fmtOpt(r.accuracy),
    isRef ? "—" : fmtOpt(r.deltaAccuracy, true),
    fmtMs(r.p50DurationMs),
    isRef ? "—" : fmtMs(r.deltaP50Ms, true),
    fmtMs(r.p95DurationMs),
    isRef ? "—" : fmtMs(r.deltaP95Ms, true),
    tok,
    String(r.clientFailedRuns),
  ];
}

const MODEL_HEAD = ["Modelo", "passRate", "Δ pass", "Accuracy", "Δ acc", "p50", "Δ p50", "p95", "Δ p95", "Tokens (P/C/T)", "Fallas cliente"];

function mdTable(head: string[], rows: string[][]): string[] {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
}

function renderModelComparisonMarkdown(report: ComparisonReport): string[] {
  const comps = report.modelComparisons ?? [];
  if (comps.length === 0) return [];
  const lines: string[] = ["## Comparación entre Modelos", ""];
  lines.push(
    "Mismo dataset y variante contra cada modelo. Los deltas son contra el **primer modelo** de la lista (ref). " +
      "Cada modelo corre solo las etapas de su tipo; la accuracy es la de las decisiones.",
    "",
  );
  for (const c of comps) {
    lines.push(`### \`${c.variant}\` — ${c.dataset} — ${SCOPE_LABEL[c.scope]}`, "");
    lines.push(...mdTable(MODEL_HEAD, c.overall.map((r, i) => modelRowCells(r, i === 0))), "");
    for (const st of c.stages) {
      lines.push(`**\`${st.stageKey}\`**`, "");
      lines.push(...mdTable(MODEL_HEAD, st.rows.map((r, i) => modelRowCells(r, i === 0))), "");
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
          return r ? [`${fmtPct(r.accuracy)} (${r.graded})`, r.fp !== undefined ? `FP ${r.fp} / FN ${r.fn}` : String(r.errors)] : ["—", "—"];
        }),
      ]);
      lines.push(...mdTable(head, rows), "");
    }
    if (c.disagreements.length === 0) {
      lines.push("Los modelos obtuvieron el mismo resultado en todos los casos.", "");
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
    "Etapas de decisión con 2 o más preguntas evaluadas en el mismo request. FP = se predijo la clase y no era; FN = era y no se predijo. En `noul` la clase positiva es `yes`.",
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
    "Agregado sobre todos los datasets y etapas. Las fallas de cliente (red, timeout, HTTP) cuentan como falla en passRate.",
    "",
    ...renderModelComparisonMarkdown(report),
    "## 1. Resumen por Etapa",
    "",
    "| Variante | Modelo | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];

  for (const c of report.cells) {
    const tokensStr = c.tokens
      ? `${c.tokensEstimated ? "~" : ""}${c.tokens.avgPrompt}/${c.tokens.avgCompletion}/${c.tokens.avgTotal}`
      : "—";
    const accStr = c.accuracy !== undefined ? `${(c.accuracy * 100).toFixed(1)}%` : "—";
    lines.push(
      `| \`${c.variant}\` | ${c.model ?? "—"} | ${c.dataset} | \`${c.stageKey}\` | ${fmtPct(c.passRate)} (${c.passedRuns}/${c.totalRuns}) | ${fmtPct(c.passAllRate)} | ${c.p50DurationMs}ms | ${c.p95DurationMs}ms | ${tokensStr} | ${accStr} |`,
    );
  }

  if (report.cells.some((c) => c.tokensEstimated)) {
    lines.push("", "`~` = tokens estimados (caracteres/3), no medidos por el modelo.");
  }

  lines.push("", "## 2. Deltas vs Baseline");
  if (report.deltas.length === 0) {
    lines.push("", "Sin deltas (no hay variantes para comparar contra la baseline).");
  } else {
    lines.push(
      "",
      "| Variante | Modelo | Dataset | Stage | Δ passRate | Δ Accuracy | Δ p50 |",
      "|---|---|---|---|---|---|---|",
    );

    for (const d of report.deltas) {
      const accDelta = d.deltaAccuracy !== undefined ? fmtDeltaPct(d.deltaAccuracy) : "—";
      lines.push(
        `| \`${d.variant}\` | ${d.model ?? "—"} | ${d.dataset} | \`${d.stageKey}\` | ${fmtDeltaPct(d.deltaPassRate)} | ${accDelta} | ${fmtDeltaMs(d.deltaP50Ms)} |`,
      );
    }
  }

  lines.push("", "## 3. Regresiones");
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

  lines.push("", "## 4. Mejoras");
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

  // Matrices de confusión
  const withConfusion = report.cells.filter((c) => c.confusionMatrix !== undefined);
  if (withConfusion.length > 0) {
    lines.push("", "## 5. Matrices de Confusión", "");
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

  lines.push(...renderQuestionsMarkdown(report, withConfusion.length > 0 ? 6 : 5));

  return lines.join("\n") + "\n";
}

/**
 * Imprime un resumen de comparación legible en consola.
 */
/** Comparación directa entre modelos en consola: una tabla por grupo, y accuracy por pregunta. */
export function printModelComparison(report: ComparisonReport): void {
  for (const c of report.modelComparisons ?? []) {
    console.log(`\n── Comparación entre modelos: ${c.variant} / ${c.dataset} (${SCOPE_LABEL[c.scope]}) ──`);
    const head = ["Modelo", "passRate", "Δ pass", "Accuracy", "Δ acc", "p50", "Δ p50", "p95", "Δ p95", "Fallas cliente"];
    const cell = (r: ModelRow, i: number): string[] => {
      const x = modelRowCells(r, i === 0);
      return [r.model + (i === 0 ? " (ref)" : ""), x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8], x[10]];
    };
    const rows = [head, ...c.overall.map(cell)];
    const widths = head.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
    rows.forEach((r, idx) => {
      console.log("  " + r.map((v, i) => v.padEnd(widths[i])).join("  "));
      if (idx === 0) console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
    });
    for (const st of c.stages) {
      const parts = st.rows.map((r, i) => {
        const d = i === 0 || r.deltaPassRate === undefined ? "" : ` (${fmtDeltaPct(r.deltaPassRate)})`;
        const acc = r.accuracy !== undefined ? ` acc ${fmtPct(r.accuracy)}` : "";
        return `${r.model} ${fmtPct(r.passRate)}${d}${acc} p50 ${r.p50DurationMs}ms`;
      });
      console.log(`  [${st.stageKey}] ${parts.join("  |  ")}`);
    }
    for (const q of c.questions) {
      const parts = q.rows.map(
        (r) => `${r.model} ${fmtPct(r.accuracy)} (${errorSummary({ graded: r.graded, correct: r.graded - r.errors }, r.fp !== undefined ? { fp: r.fp, fn: r.fn as number } : undefined)})`,
      );
      console.log(`  [${q.stageKey}] pregunta ${q.question}${q.role === "main" ? " (principal)" : ""}: ${parts.join("  |  ")}`);
    }
    if (c.disagreements.length > 0) console.log(`  ${c.disagreements.length} caso(s) donde los modelos discrepan (ver comparison.md).`);
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
        `    ${k.padEnd(14)} ${fmtPct(q.accuracy).padStart(6)} (${q.correct}/${q.graded})  ${errorSummary(q, yesNoFpFn(q))}${q.role === "main" ? "  [principal]" : ""}`,
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
        `  ${d.variant}${d.model ? ` {${d.model}}` : ""} [${d.dataset}/${d.stageKey}]: Δ pass: ${fmtDeltaPct(d.deltaPassRate)}${deltaAccStr} | Δ p50: ${fmtDeltaMs(d.deltaP50Ms)}`,
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