#!/usr/bin/env node
/**
 * eval/prompts/cli.ts
 *
 * Punto de entrada del eval. Uso:
 *   npx tsx eval/prompts/cli.ts [flags]
 *
 * Secciones: 6, 7, 12.
 */

import { mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionClient } from "./core/client/decision.ts";
import { createDecisionClient } from "./core/client/decision.ts";
import type { GenerativeClient } from "./core/client/generative.ts";
import { createGenerativeClient } from "./core/client/generative.ts";
import { createMockDecisionClient } from "./core/client/mock.ts";
import { createMockGenerativeClient } from "./core/client/mock.ts";
import { oracleDecisionResponder, oracleGenerativeResponder } from "./core/client/oracle.ts";
import { parseConfig } from "./core/config.ts";
import { filterCases, loadDatasets } from "./core/datasets.ts";
import type { InputCell } from "./core/report.ts";
import { generateComparisonReport, printComparisonSummary, printVariantSummary, writeComparison } from "./core/report.ts";
import { buildRunMeta, createCellWriter, newRunId, runRootDir, timestampDir } from "./core/results.ts";
import { runDataset } from "./core/runner.ts";
import { computeScoreSummary } from "./core/scoring.ts";
import { allStageNames } from "./core/stages/index.ts";
import type { RunRecord, StageName } from "./core/types.ts";
import { loadVariantSpec } from "./core/variants/load.ts";

// ───────────────────────── Consola ─────────────────────────

function log(...args: unknown[]) { console.log(...args); }
function err(...args: unknown[]) { console.error(...args); }

function fmtPct(r: number) { return `${(r * 100).toFixed(1)}%`; }

/** Imprime con qué configuración corre el eval (modelos, concurrencia, datasets, variantes, filtros). */
function printRunConfig(
  cfg: ReturnType<typeof parseConfig>,
  datasets: Array<{ name: string; path: string; cases: unknown[] }>,
  variants: Array<{ spec: string; chain: string[] }>,
): void {
  const list = (v: string[]) => (v.length > 0 ? v.join(", ") : "todos");
  const offline = cfg.client !== "real";
  const where = (model: string, url: string) => (offline ? `${model}  (sin red)` : `${model}  @ ${url}`);
  const rows: Array<[string, string]> = [
    ["Cliente", cfg.client === "real" ? "real" : `${cfg.client} (simulado, no usa modelos)`],
    ["Modelo generativo", where(cfg.model, cfg.url)],
    ["Modelo de decisión", where(cfg.decisionModel, cfg.decisionUrl)],
    ["Concurrencia", `${cfg.concurrency}${cfg.concurrency > 1 ? "  (la latencia p50/p95 no es comparable)" : ""}`],
    ["Repeticiones", String(cfg.repeat)],
    ["Thinking", cfg.thinking],
    ["Timeout", cfg.timeoutMs !== undefined ? `${cfg.timeoutMs}ms` : "default por tipo"],
    ["Variantes", variants.map((v) => (v.chain.length > 1 ? `${v.spec} [${v.chain.join(" → ")}]` : v.spec)).join(", ")],
    ["Baseline", cfg.baseline],
    ["Datasets", datasets.map((d) => `${d.name} (${d.cases.length} casos)`).join(", ")],
    ["Etapas", list(cfg.stages)],
    ["Filtros", `tags: ${list(cfg.tags)} | ids: ${list(cfg.ids)} | limit: ${cfg.limit ?? "sin límite"}`],
    ["Casos prod_shortcut", cfg.includeShortcut ? "incluidos" : "excluidos"],
  ];
  if (cfg.label) rows.push(["Label", cfg.label]);
  if (cfg.minPassRate !== undefined) rows.push(["Umbral passRate", fmtPct(cfg.minPassRate)]);
  const w = Math.max(...rows.map(([k]) => k.length));
  log("\n── Configuración ──");
  for (const [k, v] of rows) log(`  ${k.padEnd(w)}  ${v}`);
}

// ───────────────────────── Main ─────────────────────────

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  // ── Parseo de config ──
  let cfg;
  try {
    cfg = parseConfig(argv);
  } catch (e) {
    err(`Error de configuración: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  // ── --list ──
  if (cfg.list) {
    log("\nEtapas registradas:");
    for (const s of allStageNames()) log(`  ${s}`);
    log("\nVariantes disponibles (en eval/prompts/variants/):");
    // Listar archivos .ts
    try {
      const files = readdirSync("eval/prompts/variants").filter((f) => f.endsWith(".ts"));
      for (const f of files) log(`  ${f.replace(".ts", "")}`);
    } catch { log("  (no se pudo listar)"); }
    log("\nDatasets por defecto:");
    log(`  ${cfg.datasetSpecs.join(", ")}`);
    return 0;
  }

  // ── Cargar datasets ──
  let datasets;
  try {
    datasets = loadDatasets(cfg.datasetSpecs, {
      stages: cfg.stages.length > 0 ? cfg.stages : undefined,
      tags: cfg.tags.length > 0 ? cfg.tags : undefined,
      ids: cfg.ids.length > 0 ? cfg.ids : undefined,
      limit: cfg.limit,
    });
  } catch (e) {
    err(`Error de dataset: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  if (datasets.length === 0) {
    err("No se encontraron datasets.");
    return 2;
  }

  // Filtros que dejan 0 casos (ej. `--ids=typo`): antes corría vacío y salía con 0.
  const stageFilterEarly = cfg.stages.length > 0 ? cfg.stages : (allStageNames() as StageName[]);
  const totalCases = datasets.reduce(
    (n, d) => n + d.cases.filter((c) => stageFilterEarly.includes(c.stage as StageName)).length,
    0,
  );
  if (totalCases === 0) {
    err("Los filtros (--stages/--tags/--ids/--limit) no dejaron ningún caso para correr.");
    return 2;
  }

  // ── Cargar variantes ──
  const variantResults: Array<{ spec: string; chain: string[]; hash: string; variant: import("./core/variants/types.ts").Variant; parts: import("./core/variants/types.ts").Variant[] }> = [];
  for (const spec of cfg.variantSpecs) {
    try {
      const r = await loadVariantSpec(spec);
      variantResults.push({ spec, ...r });
    } catch (e) {
      err(`Error cargando variante '${spec}': ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }

  // ── Crear clientes ──
  let genClient: GenerativeClient;
  let decClient: DecisionClient;

  if (cfg.client === "mock" || cfg.client === "oracle") {
    const oracle = cfg.client === "oracle";
    genClient = createMockGenerativeClient({ url: cfg.url, model: cfg.model }, oracle ? oracleGenerativeResponder : undefined);
    decClient = createMockDecisionClient({ url: cfg.decisionUrl, model: cfg.decisionModel }, oracle ? oracleDecisionResponder : undefined);
  } else {
    try {
      genClient = createGenerativeClient({ url: cfg.url, model: cfg.model });
    } catch (e) {
      err(`Error de configuración de URL generativa: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
    decClient = createDecisionClient({ url: cfg.decisionUrl, model: cfg.decisionModel });
  }

  // ── dry-run: solo imprime bodies y sale ──
  if (cfg.dryRun) {
    log("\n=== DRY RUN ===\n");
    let applyErrors = 0;
    for (const ds of datasets) {
      for (const vr of variantResults) {
        log(`# variant=${vr.spec} dataset=${ds.name}`);
        const stageFilter = cfg.stages.length > 0 ? cfg.stages : (allStageNames() as StageName[]);
        const dry = await runDataset({
          cases: ds.cases,
          datasetName: ds.name,
          variant: vr.variant,
          variants: vr.parts,
          variantSpec: vr.spec,
          variantChain: vr.chain,
          cfg,
          genClient,
          decClient,
          stageFilter,
          dryRun: true,
        });
        for (const r of dry.records) {
          if (r.metrics.variant_apply_ok === false) {
            applyErrors++;
            err(`  ✗ ${r.caseId} [${r.variant}]: ${r.errors[0] ?? "variant_apply_error"}`);
          }
        }
      }
    }
    if (applyErrors > 0) {
      err(`\n${applyErrors} caso(s) no pudieron aplicar la variante.`);
      return 2;
    }
    return 0;
  }

  // ── Configuración de la corrida ──
  printRunConfig(cfg, datasets, variantResults);

  // ── Preparar directorio de salida ──
  const ts = timestampDir();
  const runId = newRunId();           // un id por invocación, compartido por todas las celdas
  const startedAt = new Date().toISOString();
  const rootDir = runRootDir(cfg, ts);
  mkdirSync(resolve(rootDir), { recursive: true });
  log(`\nResultados en: ${rootDir}`);

  const stageFilter = cfg.stages.length > 0 ? cfg.stages : (allStageNames() as StageName[]);
  const comparisonCells: InputCell[] = [];
  let anyNetworkFailed = false;
  let allNetworkFailed = true;

  // ── Correr (variante × dataset) ──
  for (const vr of variantResults) {
    for (const ds of datasets) {
      log(`\n▶ variant=${vr.spec}  dataset=${ds.name}  (${ds.cases.length} casos)`);

      const writer = createCellWriter(rootDir, vr.spec, ds.name);
      let runCount = 0;
      let passCount = 0;

      const meta = buildRunMeta({
        cfg,
        variantChain: vr.chain,
        variantHash: vr.hash,
        datasetPath: ds.path,
        datasetHash: ds.hash,
        stages: stageFilter,
        timestamp: startedAt,
        runId,
      });

      let result;
      try {
        result = await runDataset({
          cases: ds.cases,
          datasetName: ds.name,
          variant: vr.variant,
          variants: vr.parts,
          variantSpec: vr.spec,
          variantChain: vr.chain,
          cfg,
          genClient,
          decClient,
          stageFilter,
          onRecord: (record: RunRecord) => {
            writer.writeRun(record);
            if (record.bucket === "canonical") {
              runCount++;
              if (record.passed) passCount++;
            }
            const icon = record.passed ? "✓" : "✗";
            const bucket = record.bucket === "raw" ? " [raw]" : "";
            log(`  ${icon} ${record.caseId} [${record.stageKey}] iter=${record.iteration}${bucket}`);
          },
        });
      } finally {
        // Siempre cerrar: si el runner lanza, igual queda meta.json junto a runs.jsonl.
        writer.close(meta);
      }

      if (result.allNetworkFailed) {
        anyNetworkFailed = true;
      } else {
        allNetworkFailed = false;
      }

      const pct = runCount > 0 ? fmtPct(passCount / runCount) : "—";
      log(`  → ${passCount}/${runCount} pasados (${pct})`);
      const failedCalls = result.records.filter((r) => r.bucket === "canonical" && r.metrics.client_call_ok === false).length;
      if (failedCalls > 0) {
        log(`  ⚠ ${failedCalls} de ${runCount} runs fallaron por el cliente (red/timeout/HTTP): cuentan como falla en el pass rate.`);
      }

      comparisonCells.push({
        variantSpec: vr.spec,
        datasetName: ds.name,
        scores: computeScoreSummary(writer.records),
        records: writer.records,
      });
    }
  }

  // ── Fallo de infraestructura: todas las llamadas fallaron por red ──
  if (anyNetworkFailed && allNetworkFailed) {
    err("\nError de infraestructura: todas las llamadas fallaron por el cliente (red, timeout o HTTP).");
    return 2;
  }

  // ── Ninguna corrida canónica: no hay nada que evaluar (evita NaN y CI en verde) ──
  if (comparisonCells.every((c) => c.scores.totalRuns === 0)) {
    err("\nNo hubo ninguna corrida canónica (todos los casos son raw o se filtraron). Nada que evaluar.");
    return 2;
  }

  // ── Comparison ──
  const comparisonReport = generateComparisonReport({
    baseline: cfg.baseline,
    cells: comparisonCells,
    concurrency: cfg.concurrency,
  });
  writeComparison(rootDir, comparisonReport);

  // ── Resumen global ──
  log("\n── Resumen ──");
  for (const cell of comparisonCells) {
    const s = cell.scores;
    log(
      `  ${cell.variantSpec}/${cell.datasetName}: ` +
      `${fmtPct(s.passRate)} (${s.passedRuns}/${s.totalRuns})` +
      (s.rawTotalRuns > 0 ? ` | raw: ${fmtPct(s.rawPassRate)} (${s.rawPassedRuns}/${s.rawTotalRuns})` : ""),
    );
  }
  printVariantSummary(comparisonReport);
  printComparisonSummary(comparisonReport);
  log(`\nComparación: ${rootDir}/comparison.md`);

  // ── --min-pass-rate ──
  if (cfg.minPassRate !== undefined) {
    // Aplica a TODAS las celdas no baseline (variante × dataset); si solo corrió la baseline, a esas.
    const nonBaseline = comparisonCells.filter((c) => c.variantSpec !== cfg.baseline);
    const cells = nonBaseline.length > 0 ? nonBaseline : comparisonCells;
    const failing = cells.filter((c) => c.scores.totalRuns === 0 || !(c.scores.passRate >= cfg.minPassRate!));
    if (failing.length > 0) {
      for (const c of failing) {
        err(
          `\n${c.variantSpec}/${c.datasetName}: passRate ${c.scores.totalRuns === 0 ? "sin runs" : fmtPct(c.scores.passRate)} ` +
          `por debajo del umbral ${fmtPct(cfg.minPassRate)}.`,
        );
      }
      return 1;
    }
  }

  return 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(e);
  process.exit(2);
});