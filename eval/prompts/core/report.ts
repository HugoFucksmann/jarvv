/**
 * eval/prompts/core/report.ts
 *
 * Genera comparison.json y comparison.md, y el resumen en consola.
 * Sección 9 del plan de implementación.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GlobalScoreSummary, RunRecord } from "./types.ts";

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
}

export interface ComparisonDelta {
  variant: string;
  dataset: string;
  stageKey: string;
  deltaPassRate: number;
  deltaAccuracy?: number;
  deltaP50Ms: number;
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

export interface ComparisonReport {
  baseline: string;
  /** Resumen agregado por variante (en el orden en que corrieron). */
  variants: VariantSummary[];
  cells: CellStageReport[];
  deltas: ComparisonDelta[];
  regressions: CaseComparison[];
  improvements: CaseComparison[];
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
      });
    }
  }

  // 2. Calcular Deltas contra la baseline
  const deltas: ComparisonDelta[] = [];
  const regressions: CaseComparison[] = [];
  const improvements: CaseComparison[] = [];

  // Mapa de baseline: dataset -> Map<stageKey, CellStageReport>
  const baselineStageMap = new Map<string, Map<string, CellStageReport>>();
  // Mapa de baseline runs: dataset -> Map<caseId + "::" + stageKey, RunRecord[]>
  const baselineRunsMap = new Map<string, Map<string, RunRecord[]>>();

  for (const cell of cells) {
    if (cell.variantSpec === baseline) {
      const stageMap = new Map<string, CellStageReport>();
      for (const rep of cellReports.filter((c) => c.variant === baseline && c.dataset === cell.datasetName)) {
        stageMap.set(rep.stageKey, rep);
      }
      baselineStageMap.set(cell.datasetName, stageMap);

      const runsMap = new Map<string, RunRecord[]>();
      for (const r of cell.records.filter((rec) => rec.bucket === "canonical" && isComparable(rec))) {
        const key = `${r.caseId}::${r.stageKey}`;
        const list = runsMap.get(key) ?? [];
        list.push(r);
        runsMap.set(key, list);
      }
      baselineRunsMap.set(cell.datasetName, runsMap);
    }
  }

  // Comparar variantes contra baseline
  for (const cell of cells) {
    if (cell.variantSpec === baseline) continue;

    const baseStages = baselineStageMap.get(cell.datasetName);
    const baseRuns = baselineRunsMap.get(cell.datasetName);
    if (!baseStages || !baseRuns) continue;

    // Deltas por stageKey
    const varStages = cellReports.filter((c) => c.variant === cell.variantSpec && c.dataset === cell.datasetName);
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
  if ((opts.concurrency ?? 1) > 1 && deltas.length > 0) {
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
    warnings,
  };
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
  const order: string[] = [];
  for (const c of cells) if (!order.includes(c.variantSpec)) order.push(c.variantSpec);

  const rows: VariantSummary[] = order.map((variant) => {
    const mine = cells.filter((c) => c.variantSpec === variant);
    const canonical = mine.flatMap((c) => c.records.filter((r) => r.bucket === "canonical"));
    const totalRuns = canonical.length;
    const passedRuns = canonical.filter((r) => r.passed).length;
    const durations = canonical
      .filter((r) => r.metrics?.client_call_ok === true)
      .map((r) => r.durationMs)
      .sort((a, b) => a - b);
    return {
      variant,
      totalRuns,
      passedRuns,
      passRate: totalRuns > 0 ? passedRuns / totalRuns : 0,
      clientFailedRuns: canonical.filter((r) => r.metrics?.client_call_ok === false).length,
      regressions: regressions.filter((r) => r.variant === variant).length,
      improvements: improvements.filter((r) => r.variant === variant).length,
      p50DurationMs: durations.length > 0 ? durations[Math.floor((durations.length - 1) / 2)] : 0,
    };
  });

  const base = rows.find((r) => r.variant === baseline);
  if (base && base.totalRuns > 0) {
    for (const r of rows) if (r !== base && r.totalRuns > 0) r.deltaPassRate = r.passRate - base.passRate;
  }
  return rows;
}

function variantTableRows(report: ComparisonReport): string[][] {
  return report.variants.map((v) => [
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
  const rows = [VARIANT_TABLE_HEAD, ...variantTableRows(report)];
  const widths = VARIANT_TABLE_HEAD.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  console.log("\n── Resumen por variante ──");
  rows.forEach((r, idx) => {
    console.log("  " + r.map((c, i) => c.padEnd(widths[i])).join("  "));
    if (idx === 0) console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  });
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
    `| ${VARIANT_TABLE_HEAD.join(" | ")} |`,
    `|${VARIANT_TABLE_HEAD.map(() => "---").join("|")}|`,
    ...variantTableRows(report).map((r) => `| ${r.join(" | ")} |`),
    "",
    "Agregado sobre todos los datasets y etapas. Las fallas de cliente (red, timeout, HTTP) cuentan como falla en passRate.",
    "",
    "## 1. Resumen por Etapa",
    "",
    "| Variante | Dataset | Stage | passRate | passAllRate | p50 | p95 | Tokens (P/C/T) | Accuracy |",
    "|---|---|---|---|---|---|---|---|---|",
  ];

  for (const c of report.cells) {
    const tokensStr = c.tokens
      ? `${c.tokensEstimated ? "~" : ""}${c.tokens.avgPrompt}/${c.tokens.avgCompletion}/${c.tokens.avgTotal}`
      : "—";
    const accStr = c.accuracy !== undefined ? `${(c.accuracy * 100).toFixed(1)}%` : "—";
    lines.push(
      `| \`${c.variant}\` | ${c.dataset} | \`${c.stageKey}\` | ${fmtPct(c.passRate)} (${c.passedRuns}/${c.totalRuns}) | ${fmtPct(c.passAllRate)} | ${c.p50DurationMs}ms | ${c.p95DurationMs}ms | ${tokensStr} | ${accStr} |`,
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
      "| Variante | Dataset | Stage | Δ passRate | Δ Accuracy | Δ p50 |",
      "|---|---|---|---|---|---|",
    );

    for (const d of report.deltas) {
      const accDelta = d.deltaAccuracy !== undefined ? fmtDeltaPct(d.deltaAccuracy) : "—";
      lines.push(
        `| \`${d.variant}\` | ${d.dataset} | \`${d.stageKey}\` | ${fmtDeltaPct(d.deltaPassRate)} | ${accDelta} | ${fmtDeltaMs(d.deltaP50Ms)} |`,
      );
    }
  }

  lines.push("", "## 3. Regresiones");
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

  lines.push("", "## 4. Mejoras");
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

  // Matrices de confusión
  const withConfusion = report.cells.filter((c) => c.confusionMatrix !== undefined);
  if (withConfusion.length > 0) {
    lines.push("", "## 5. Matrices de Confusión", "");
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

  return lines.join("\n") + "\n";
}

/**
 * Imprime un resumen de comparación legible en consola.
 */
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
        `  ${d.variant} [${d.dataset}/${d.stageKey}]: Δ pass: ${fmtDeltaPct(d.deltaPassRate)}${deltaAccStr} | Δ p50: ${fmtDeltaMs(d.deltaP50Ms)}`,
      );
    }
  }

  if (report.regressions.length > 0) {
    console.log(`\n  ⚠ Regresiones (${report.regressions.length}):`);
    for (const r of report.regressions) {
      console.log(`    - ${r.caseId} [${r.stageKey}] (${r.variant}): ${r.diff}`);
    }
  }

  if (report.improvements.length > 0) {
    console.log(`\n  ★ Mejoras (${report.improvements.length}):`);
    for (const im of report.improvements) {
      console.log(`    + ${im.caseId} [${im.stageKey}] (${im.variant}): ${im.diff}`);
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