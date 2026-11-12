/**
 * eval/ui/views/run.ts
 *
 * Vistas de la corrida: configuración, avance por celda (variante × dataset) y resumen global.
 * Solo formatean y imprimen; no leen disco ni calculan métricas.
 */

import type { parseConfig } from "../../core/config.ts";
import type { InputCell } from "../../core/report.ts";
import type { RunRecord } from "../../core/types.ts";
import { fmtPct } from "../../core/report-format.ts";
import { c, kv, padEnd, rateColor, section, sym } from "../style.ts";

/** Imprime con qué configuración corre el eval (modelos, concurrencia, datasets, variantes, filtros). */
export function printRunConfig(
  cfg: ReturnType<typeof parseConfig>,
  datasets: Array<{ name: string; path: string; cases: unknown[] }>,
  variants: Array<{ spec: string }>,
): void {
  const list = (v: string[]) => (v.length > 0 ? v.join(", ") : "todos");
  const offline = cfg.client !== "real";
  const where = (model: string, url: string) => (offline ? `${model}  ${c.gray("(sin red)")}` : `${model}  ${c.gray(`@ ${url}`)}`);
  const rows: Array<[string, string]> = [
    ["Cliente", cfg.client === "real" ? "real" : `${c.yellow(cfg.client)} ${c.gray("(simulado, no usa modelos)")}`],
    ["Modelo generativo", where(cfg.model, cfg.url)],
    ["Modelo de decisión", where(cfg.decisionModel, cfg.decisionUrl)],
    ["Concurrencia", `${cfg.concurrency}${cfg.concurrency > 1 ? `  ${c.yellow("(la latencia p50/p95 no es comparable)")}` : ""}`],
    ["Repeticiones", String(cfg.repeat)],
    ["Thinking", cfg.thinking],
    ["Timeout", cfg.timeoutMs !== undefined ? `${cfg.timeoutMs}ms` : "default por tipo"],
    ["Variantes", variants.map((v) => v.spec).join(", ")],
    ["Baseline", cfg.baseline],
    ["Datasets", datasets.map((d) => `${d.name} ${c.gray(`(${d.cases.length} casos)`)}`).join(", ")],
    ["Etapas", list(cfg.stages)],
    ["Filtros", `tags: ${list(cfg.tags)} | ids: ${list(cfg.ids)} | limit: ${cfg.limit ?? "sin límite"}`],
    ["Casos prod_shortcut", cfg.includeShortcut ? "incluidos" : "excluidos"],
  ];
  if (cfg.label) rows.push(["Label", cfg.label]);
  if (cfg.minPassRate !== undefined) rows.push(["Umbral passRate", fmtPct(cfg.minPassRate)]);
  section("Configuración");
  kv(rows);
}

/** Cabecera de cada (variante × dataset) en `--dry-run`. */
export function printDryRunHeader(variantSpec: string, datasetName: string): void {
  console.log(`\n${c.cyan("#")} variant=${c.bold(variantSpec)} dataset=${c.bold(datasetName)}`);
}

/** Cabecera de cada celda (variante × dataset) al empezar a correrla. */
export function printCellStart(variantSpec: string, datasetName: string, cases: number): void {
  console.log(`\n${c.violet("▶")} ${c.bold(variantSpec)} ${c.gray("×")} ${c.bold(datasetName)}  ${c.gray(`${cases} casos`)}`);
}

/** Línea de un run terminado. */
export function recordLine(record: RunRecord, repeat: number): string {
  const icon = record.passed ? sym.ok : sym.err;
  const id = record.passed ? c.dim(record.caseId) : record.caseId;
  const iter = repeat > 1 ? c.gray(` iter=${record.iteration}`) : "";
  const bucket = record.bucket === "raw" ? c.gray(" [raw]") : "";
  return `  ${icon} ${id} ${c.gray(`[${record.stageKey}]`)}${iter}${bucket}`;
}

/** Cierre de una celda: pasados/total, porcentaje y aviso si fallaron llamadas del cliente. */
export function printCellResult(passCount: number, runCount: number, failedCalls: number): void {
  const rate = runCount > 0 ? passCount / runCount : 0;
  const pct = runCount > 0 ? rateColor(rate, fmtPct(rate)) : c.gray("—");
  console.log(`  ${c.gray("→")} ${c.bold(`${passCount}/${runCount}`)} pasados ${c.gray("(")}${pct}${c.gray(")")}`);
  if (failedCalls > 0) {
    console.log(`  ${sym.warn} ${c.yellow(`${failedCalls} de ${runCount} runs fallaron por el cliente (red/timeout/HTTP): cuentan como falla en el pass rate.`)}`);
  }
}

/** Tabla de resumen global: una fila por celda (variante × dataset). */
export function printGlobalSummary(cells: InputCell[]): void {
  const rows = cells.map((cell) => {
    const s = cell.scores;
    return {
      label: `${cell.variantSpec}/${cell.datasetName}`,
      rate: s.passRate,
      pct: fmtPct(s.passRate),
      counts: `${s.passedRuns}/${s.totalRuns}`,
      raw: s.rawTotalRuns > 0 ? `raw ${fmtPct(s.rawPassRate)} (${s.rawPassedRuns}/${s.rawTotalRuns})` : "",
    };
  });
  const labelW = Math.max(...rows.map((r) => r.label.length));
  const countW = Math.max(...rows.map((r) => r.counts.length));
  section("Resumen");
  for (const r of rows) {
    console.log(
      `  ${padEnd(c.bold(r.label), labelW)}  ${rateColor(r.rate, r.pct.padStart(6))}  ${c.gray(r.counts.padStart(countW))}` +
      (r.raw ? `  ${c.gray(r.raw)}` : ""),
    );
  }
}