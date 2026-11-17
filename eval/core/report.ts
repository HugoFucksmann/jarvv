/**
 * eval/core/report.ts
 *
 * Calcula el reporte de comparación y escribe comparison.json y comparison.md.
 * El formato compartido vive en `report-format.ts`; el resumen en consola, en `ui/views/comparison.ts`.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DECISION_STAGES } from "./case.ts";
import { hasLatency, isDecisionCorrect, percentile } from "./scoring.ts";
import { fmtDeltaMs, fmtDeltaPct, fmtMs, fmtP95, fmtPct, MIN_P95_SAMPLES, variantTableHead, variantTableRows } from "./report-format.ts";
import type { GlobalScoreSummary, QuestionCross, QuestionScore, RunRecord, StageName } from "./types.ts";

export interface InputCell {
  variantSpec: string;
  datasetName: string;
  scores: GlobalScoreSummary;
  records: RunRecord[];
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

/**
 * Solo un run cuya llamada se completó mide al modelo. Una falla de cliente (red, timeout, HTTP) no dice nada sobre el prompt:
 * no debe aparecer como regresión ni como mejora.
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

/** Latencias de los runs con llamada completada. */
function latencies(records: RunRecord[]): { p50?: number; p95?: number; samples: number } {
  const durations = records.filter(hasLatency).map((r) => r.durationMs).sort((a, b) => a - b);
  if (durations.length === 0) return { samples: 0 };
  return { p50: percentile(durations, 50), p95: percentile(durations, 95), samples: durations.length };
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

  // 2. Comparar cada celda contra la baseline del mismo dataset.
  const deltas: ComparisonDelta[] = [];
  const regressions: CaseComparison[] = [];
  const improvements: CaseComparison[] = [];
  const rawRegressions: CaseComparison[] = [];
  const rawImprovements: CaseComparison[] = [];
  const unpairedByVariant = new Map<string, number>();

  const reportsOf = (cell: InputCell): CellStageReport[] =>
    cellReports.filter((c) => c.variant === cell.variantSpec && c.dataset === cell.datasetName);

  for (const cell of cells) {
    if (cell.variantSpec === baseline) continue;
    const base = cells.find(
      (c) => c.variantSpec === baseline && c.datasetName === cell.datasetName,
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
      `\`${variant}\`: ${count} caso(s) sin medición comparable contra la baseline (llamada fallida o etapa distinta). ` +
      "Cuentan como falla en su passRate pero quedan fuera de Δ, regresiones y mejoras: passRate y Δ pueden no cuadrar.",
    );
  }
  if ((opts.concurrency ?? 1) > 1 && deltas.length > 0) {
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
    warnings,
  };
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

type SummaryKind = NonNullable<VariantSummary["kind"]>;

const KIND_ORDER: SummaryKind[] = ["generative", "decision", "total"];

/** Tipo de modelo que corre una etapa. `stageKey` puede traer sufijo de thinking (`final[think=on]`). */
function kindOfStage(stageOrKey: string): "generative" | "decision" {
  const stage = stageOrKey.replace(/\[.*\]$/, "");
  return (DECISION_STAGES as readonly string[]).includes(stage) ? "decision" : "generative";
}

/**
 * Una fila por (tipo de etapas, variante). Los tipos (generativo / decisión) se resumen por separado porque
 * los corren modelos distintos: un total mezclado puede esconder que una variante mejora un tipo y empeora el otro.
 * El total solo se agrega cuando hay ambos tipos. Los deltas son contra la baseline del mismo tipo, sobre los
 * casos medidos en ambos lados; regresiones y mejoras salen de esos mismos pares.
 */
function summarizeVariants(baseline: string, cells: InputCell[]): VariantSummary[] {
  const variants: string[] = [];
  for (const c of cells) {
    if (!variants.includes(c.variantSpec)) variants.push(c.variantSpec);
  }

  const rows: VariantSummary[] = [];
  const byVariant = new Map(
    variants.map((v) => [
      v,
      cells
        .filter((c) => c.variantSpec === v)
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
        kind,
        totalRuns: canonical.length,
        passedRuns,
        passRate: canonical.length > 0 ? passedRuns / canonical.length : 0,
        macroPassRate: stageRates.length > 0 ? mean(stageRates) : 0,
        clientFailedRuns: canonical.filter((r) => r.metrics?.client_call_ok === false).length,
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
      rows.find((r) => r.variant === total.variant && r.kind === kind)?.deltaPassRate;
    const gen = delta("generative");
    const dec = delta("decision");
    if (gen === undefined || dec === undefined) continue;
    if ((gen > EPS && dec < -EPS) || (gen < -EPS && dec > EPS)) {
      out.push(
        `Resultado mixto en \`${total.variant}\`: generativo ${fmtDeltaPct(gen)}, ` +
        `decisión ${fmtDeltaPct(dec)}; el total (${fmtDeltaPct(total.deltaPassRate as number)}) mezcla ambos y no es representativo. ` +
        "Decidir con el desglose por tipo.",
      );
    }
  }
  return out;
}

const P95_NOTE = `\`†\` = menos de ${MIN_P95_SAMPLES} muestras: el p95 es el máximo, suele ser la carga en frío del modelo y no se publica su delta.`;
const SIGN_NOTE =
  "`p`: prueba de signos sobre los casos que cambiaron. Un p alto significa que el cambio es compatible con ruido, no que no exista; con menos de 6 casos que cambian nunca baja de 0.05.";

function mdTable(head: string[], rows: string[][]): string[] {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
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
    lines.push(`### \`${c.variant}\` — ${c.dataset} — \`${c.stageKey}\``, "");
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
 * Resumen por etapa con las variantes lado a lado: una fila por (dataset, etapa) y una columna por variante en cada
 * métrica. En las variantes que no son la baseline, el delta contra la baseline va entre paréntesis.
 */
function renderStageTable(report: ComparisonReport): string[] {
  const variants = [...new Set(report.cells.map((c) => c.variant))];
  const rowKey = (c: CellStageReport): string => `${c.dataset}\u0000${c.stageKey}`;
  const rows = new Map<string, Map<string, CellStageReport>>();
  for (const c of report.cells) {
    const m = rows.get(rowKey(c)) ?? new Map<string, CellStageReport>();
    m.set(c.variant, c);
    rows.set(rowKey(c), m);
  }
  const hasAcc = report.cells.some((c) => c.accuracy !== undefined);
  const hasTokens = report.cells.some((c) => c.tokens !== undefined);
  // passAll solo agrega información con repeticiones: con una sola, es lo mismo que passRate.
  const hasRepeats = report.cells.some((c) => c.totalRuns > c.cases);
  const deltaKey = (variant: string, c: { dataset: string; stageKey: string }): string =>
    `${variant}\u0000${c.dataset}\u0000${c.stageKey}`;
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
    "Stage",
    ...metrics.flatMap((m) => variants.map((v) => `${m.head} \`${v}\`${v === report.baseline ? " (base)" : ""}`)),
  ];
  const lines = ["## 1. Resumen por Etapa", ""];
  const body: string[][] = [];
  for (const m of rows.values()) {
    const any = [...m.values()][0];
    body.push([
      any.dataset,
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
      ["Variante", "Dataset", "Stage", "Raw"],
      cells.map((c) => [
        `\`${c.variant}\``,
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
        ["Cambio", "Variante", "Dataset", "Caso", "Stage", "Detalle"],
        changes.map((x) => [x.kind, `\`${x.variant}\``, x.dataset, `\`${x.caseId}\``, `\`${x.stageKey}\``, x.diff]),
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
    "Agregado sobre todos los datasets, por tipo de etapas (generativo / decisión). **Sin medir** = llamadas fallidas (red, timeout, HTTP): cuentan como falla en passRate, pero Δ, regresiones y mejoras comparan solo casos medidos en ambos lados. **Macro por etapa** pesa cada etapa por igual (en passRate pesan según su cantidad de casos).",
    SIGN_NOTE,
    "",
    ...renderStageTable(report),
  ];

  lines.push("", "## 2. Regresiones");
  if (report.regressions.length === 0) {
    lines.push("", "Sin regresiones.");
  } else {
    lines.push(
      "",
      "| Variante | Dataset | Caso | Stage | Baseline | Variante | Cambio |",
      "|---|---|---|---|---|---|---|",
    );
    for (const r of report.regressions) {
      lines.push(
        `| \`${r.variant}\` | ${r.dataset} | \`${r.caseId}\` | \`${r.stageKey}\` | ${r.baseline} | ${r.variantResult} | ${r.diff} |`,
      );
    }
  }

  lines.push("", "## 3. Mejoras");
  if (report.improvements.length === 0) {
    lines.push("", "Sin mejoras.");
  } else {
    lines.push(
      "",
      "| Variante | Dataset | Caso | Stage | Baseline | Variante | Cambio |",
      "|---|---|---|---|---|---|---|",
    );
    for (const im of report.improvements) {
      lines.push(
        `| \`${im.variant}\` | ${im.dataset} | \`${im.caseId}\` | \`${im.stageKey}\` | ${im.baseline} | ${im.variantResult} | ${im.diff} |`,
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
      lines.push(`### \`${c.variant}\` — ${c.dataset} — \`${c.stageKey}\``, "");
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
 * Escribe comparison.json y comparison.md en el directorio raíz de la corrida.
 */
export function writeComparison(rootDir: string, report: ComparisonReport): void {
  const jsonPath = resolve(`${rootDir}/comparison.json`);
  const mdPath = resolve(`${rootDir}/comparison.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(mdPath, renderComparisonMarkdown(report), "utf8");
}