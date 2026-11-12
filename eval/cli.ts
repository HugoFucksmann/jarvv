#!/usr/bin/env node
/**
 * eval/cli.ts
 *
 * Punto de entrada del eval. Uso:
 *   npx tsx eval/cli.ts [flags]
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionClient } from "./core/client/decision.ts";
import { createDecisionClient } from "./core/client/decision.ts";
import type { GenerativeClient } from "./core/client/generative.ts";
import { createGenerativeClient } from "./core/client/generative.ts";
import { createMockDecisionClient } from "./core/client/mock.ts";
import { createMockGenerativeClient } from "./core/client/mock.ts";
import { oracleDecisionResponder, oracleGenerativeResponder } from "./core/client/oracle.ts";
import { parseConfig } from "./core/config.ts";
import { loadDatasets } from "./core/datasets.ts";
import type { InputCell } from "./core/report.ts";
import { generateComparisonReport, writeComparison } from "./core/report.ts";
import { buildRunMeta, createCellWriter, newRunId, runRootDir, timestampDir } from "./core/results.ts";
import { runDataset } from "./core/runner.ts";
import { computeScoreSummary } from "./core/scoring.ts";
import { allStageNames } from "./core/stages/index.ts";
import type { RunRecord, StageName } from "./core/types.ts";
import { loadVariantSpec } from "./core/variants/load.ts";
import type { Variant } from "./core/variants/types.ts";
import { fmtPct } from "./core/report-format.ts";
import { c, fail, section } from "./ui/style.ts";
import { printHelp } from "./ui/views/help.ts";
import { printList } from "./ui/views/list.ts";
import { printComparisonSummary, printQuestionSummary, printStageSummary, printVariantSummary } from "./ui/views/comparison.ts";
import { printCellResult, printCellStart, printDryRunHeader, printGlobalSummary, printRunConfig, recordLine } from "./ui/views/run.ts";
import { runWizard } from "./ui/wizard.ts";

// ───────────────────────── Consola ─────────────────────────

function log(...args: unknown[]) { console.log(...args); }

/** Crea los clientes de un target (con sus modelos). Lanza si la URL generativa es inválida. */
function makeClients(cfg: ReturnType<typeof parseConfig>): { genClient: GenerativeClient; decClient: DecisionClient } {
  if (cfg.client === "mock" || cfg.client === "oracle") {
    const oracle = cfg.client === "oracle";
    return {
      genClient: createMockGenerativeClient({ url: cfg.url, model: cfg.model }, oracle ? oracleGenerativeResponder : undefined),
      decClient: createMockDecisionClient({ url: cfg.decisionUrl, model: cfg.decisionModel }, oracle ? oracleDecisionResponder : undefined),
    };
  }
  return {
    genClient: createGenerativeClient({ url: cfg.url, model: cfg.model }),
    decClient: createDecisionClient({ url: cfg.decisionUrl, model: cfg.decisionModel }),
  };
}

// ───────────────────────── Main ─────────────────────────

async function main(): Promise<number> {
  let argv = process.argv.slice(2);

  // ── --help / --menu ──
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }
  if (argv.includes("--menu")) {
    const chosen = await runWizard();
    if (chosen === null) return 0;
    argv = chosen;
  }

  // ── Parseo de config ──
  let cfg;
  try {
    cfg = parseConfig(argv);
  } catch (e) {
    fail(`Error de configuración: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  // ── --list ──
  if (cfg.list) {
    printList(cfg.baseline, cfg.datasetSpecs);
    return 0;
  }

  // ── Cargar datasets ──
  const datasetFilters = {
    stages: cfg.stages.length > 0 ? cfg.stages : undefined,
    tags: cfg.tags.length > 0 ? cfg.tags : undefined,
    ids: cfg.ids.length > 0 ? cfg.ids : undefined,
    limit: cfg.limit,
  };
  let datasets;
  try {
    datasets = loadDatasets(cfg.datasetSpecs, datasetFilters);
  } catch (e) {
    fail(`Error de dataset: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  if (datasets.length === 0) {
    fail("No se encontraron datasets.");
    return 2;
  }

  // Filtros que dejan 0 casos (ej. `--ids=typo`): antes corría vacío y salía con 0.
  const stageFilter = cfg.stages.length > 0 ? cfg.stages : (allStageNames() as StageName[]);
  const totalCases = datasets.reduce(
    (n, d) => n + d.cases.filter((k) => stageFilter.includes(k.stage as StageName)).length,
    0,
  );
  if (totalCases === 0) {
    fail("Los filtros (--stages/--tags/--ids/--limit) no dejaron ningún caso para correr.");
    return 2;
  }

  // ── Cargar variantes ──
  const variantResults: Array<{ spec: string; hash: string; variant: Variant }> = [];
  for (const spec of cfg.variantSpecs) {
    try {
      const r = await loadVariantSpec(spec);
      variantResults.push({ spec, ...r });
    } catch (e) {
      fail(`Error cargando variante '${spec}': ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }

  // ── Casos de cada variante: se arman una vez con los prompts de la variante (los escenarios + sus prompts enteros); el runner solo envía ──
  const datasetsByVariant = new Map<string, typeof datasets>();
  for (const vr of variantResults) {
    try {
      const own = loadDatasets(cfg.datasetSpecs, datasetFilters, vr.variant);
      if (own.every((d) => d.cases.length === 0)) {
        fail(`La variante '${vr.spec}' no dejó ningún caso para correr.`);
        return 2;
      }
      datasetsByVariant.set(vr.spec, own);
    } catch (e) {
      fail(`Error de dataset con la variante '${vr.spec}': ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }

  // ── Clientes: un modelo generativo y uno de decisión ──
  let clients: ReturnType<typeof makeClients>;
  try {
    clients = makeClients(cfg);
  } catch (e) {
    fail(`Error de configuración de URL generativa: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  // ── dry-run: solo imprime bodies y sale ──
  if (cfg.dryRun) {
    section("Dry run");
    for (const vr of variantResults) {
      for (const ds of datasetsByVariant.get(vr.spec) ?? []) {
        printDryRunHeader(vr.spec, ds.name);
        await runDataset({
          cases: ds.cases,
          datasetName: ds.name,
          variant: vr.variant,
          variantSpec: vr.spec,
          cfg,
          genClient: clients.genClient,
          decClient: clients.decClient,
          stageFilter,
          dryRun: true,
        });
      }
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
  log(`\n${c.gray("Resultados en")} ${c.cyan(rootDir)}`);

  const comparisonCells: InputCell[] = [];
  let anyNetworkFailed = false;
  let allNetworkFailed = true;

  section("Ejecución");

  // ── Correr (variante × dataset) ──
  for (const vr of variantResults) {
    for (const ds of datasetsByVariant.get(vr.spec) ?? []) {
      const cases = ds.cases;

      printCellStart(vr.spec, ds.name, cases.length);

      const writer = createCellWriter(rootDir, vr.spec, ds.name);
      let runCount = 0;
      let passCount = 0;

      const meta = buildRunMeta({
        cfg,
        variantHash: vr.hash,
        datasetPath: ds.path,
        datasetHash: ds.hash,
        stages: stageFilter,
        timestamp: startedAt,
        runId,
        caseIds: cases.filter((k) => stageFilter.includes(k.stage as StageName)).map((k) => k.id),
      });

      let result;
      try {
        result = await runDataset({
          cases,
          datasetName: ds.name,
          variant: vr.variant,
          variantSpec: vr.spec,
          cfg,
          genClient: clients.genClient,
          decClient: clients.decClient,
          stageFilter,
          onRecord: (record: RunRecord) => {
            writer.writeRun(record);
            if (record.bucket === "canonical") {
              runCount++;
              if (record.passed) passCount++;
            }
            log(recordLine(record, cfg.repeat));
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

      const failedCalls = result.records.filter((r) => r.bucket === "canonical" && r.metrics.client_call_ok === false).length;
      printCellResult(passCount, runCount, failedCalls);

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
    fail("Error de infraestructura: todas las llamadas fallaron por el cliente (red, timeout o HTTP).");
    return 2;
  }

  // ── Ninguna corrida canónica: no hay nada que evaluar (evita NaN y CI en verde) ──
  if (comparisonCells.every((cell) => cell.scores.totalRuns === 0)) {
    fail("No hubo ninguna corrida canónica (todos los casos son raw o se filtraron). Nada que evaluar.");
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
  printGlobalSummary(comparisonCells);
  printVariantSummary(comparisonReport);
  printStageSummary(comparisonReport);
  printQuestionSummary(comparisonReport);
  printComparisonSummary(comparisonReport);
  log(`\n${c.gray("Comparación")} ${c.cyan(`${rootDir}/comparison.md`)}\n`);

  // ── --min-pass-rate ──
  if (cfg.minPassRate !== undefined) {
    // Aplica a TODAS las celdas no baseline (variante × dataset); si solo corrió la baseline, a esas.
    const nonBaseline = comparisonCells.filter((cell) => cell.variantSpec !== cfg.baseline);
    const cells = nonBaseline.length > 0 ? nonBaseline : comparisonCells;
    const failing = cells.filter((cell) => cell.scores.totalRuns === 0 || !(cell.scores.passRate >= cfg.minPassRate!));
    if (failing.length > 0) {
      for (const cell of failing) {
        fail(
          `${cell.variantSpec}/${cell.datasetName}: passRate ${cell.scores.totalRuns === 0 ? "sin runs" : fmtPct(cell.scores.passRate)} ` +
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