#!/usr/bin/env node
/**
 * eval/cli.ts
 *
 * Punto de entrada del eval. Uso:
 *   npx tsx eval/cli.ts [flags]
 *   npx tsx eval/cli.ts --auto --stage=<etapa> --max-loops=<n> --target=<0..1> --optimizer-model=<llm> [flags]
 */

import { createEvalClients, executeComparisonBatch } from "./core/batch.ts";
import { parseConfig } from "./core/config.ts";
import { createRawDatasetCache, loadDatasets } from "./core/datasets.ts";
import { fmtPct } from "./core/report-format.ts";
import { runDataset } from "./core/runner.ts";
import { allStageNames } from "./core/stages/index.ts";
import type { StageName } from "./core/types.ts";
import { loadVariantSpec } from "./core/variants/load.ts";
import type { Variant } from "./core/variants/types.ts";
import { c, fail, section } from "./ui/style.ts";
import { printComparisonSummary, printQuestionSummary, printStageSummary, printVariantSummary } from "./ui/views/comparison.ts";
import { printHelp } from "./ui/views/help.ts";
import { printList } from "./ui/views/list.ts";
import { printCellResult, printCellStart, printDryRunHeader, printGlobalSummary, printRunConfig, recordLine } from "./ui/views/run.ts";
import { runWizard } from "./ui/wizard.ts";

// ───────────────────────── Consola ─────────────────────────

function log(...args: unknown[]) { console.log(...args); }

// ───────────────────────── Main ─────────────────────────

async function main(): Promise<number> {
  let argv = process.argv.slice(2);

  // ── --auto ──
  if (argv.includes("--auto")) {
    const { runAutoCli } = await import("./auto.ts");
    return runAutoCli(argv.filter((a) => a !== "--auto"));
  }

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
  let cfg: ReturnType<typeof parseConfig>;
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
  const rawDatasetCache = createRawDatasetCache();
  let datasets: ReturnType<typeof loadDatasets>;
  try {
    datasets = loadDatasets(cfg.datasetSpecs, datasetFilters, undefined, rawDatasetCache);
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
    if (vr.spec === "prod") {
      datasetsByVariant.set(vr.spec, datasets);
      continue;
    }
    try {
      const own = loadDatasets(cfg.datasetSpecs, datasetFilters, vr.variant, rawDatasetCache);
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
  let clients: ReturnType<typeof createEvalClients>;
  try {
    clients = createEvalClients(cfg);
  } catch (e) {
    fail(`Error de configuración de modelos/URLs: ${e instanceof Error ? e.message : String(e)}`);
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

  // ── Ejecución compartida + comparación ──
  const batch = await executeComparisonBatch({
    cfg,
    variants: variantResults,
    datasetsByVariant,
    stageFilter,
    clients,
    onRootReady: (rootDir) => {
      log(`\n${c.gray("Resultados en")} ${c.cyan(rootDir)}`);
      section("Ejecución");
    },
    onCellStart: ({ variantSpec, dataset }) => {
      printCellStart(variantSpec, dataset.name, dataset.cases.length);
    },
    onRecord: (record) => {
      log(recordLine(record, cfg.repeat));
    },
    onCellEnd: ({ passCount, runCount, failedCalls }) => {
      printCellResult(passCount, runCount, failedCalls);
    },
  });

  if (!batch.ok) {
    fail(batch.reason);
    return 2;
  }

  // ── Resumen global ──
  printGlobalSummary(batch.cells);
  printVariantSummary(batch.report);
  printStageSummary(batch.report);
  printQuestionSummary(batch.report);
  printComparisonSummary(batch.report);
  log(`\n${c.gray("Comparación")} ${c.cyan(`${batch.rootDir}/comparison.md`)}\n`);

  // ── --min-pass-rate ──
  const minPassRate = cfg.minPassRate;
  if (minPassRate !== undefined) {
    // Aplica a TODAS las celdas no baseline (variante × dataset); si solo corrió la baseline, a esas.
    // Las variantes `structure` no son comparables con la baseline y no cuentan para el umbral.
    const nonBaseline = batch.cells.filter((cell) => cell.variantSpec !== cfg.baseline && cell.variantMode !== "structure");
    const cells = nonBaseline.length > 0 ? nonBaseline : batch.cells;
    const failing = cells.filter((cell) => cell.scores.totalRuns === 0 || !(cell.scores.passRate >= minPassRate));
    if (failing.length > 0) {
      for (const cell of failing) {
        fail(
          `${cell.variantSpec}/${cell.datasetName}: passRate ${cell.scores.totalRuns === 0 ? "sin runs" : fmtPct(cell.scores.passRate)} ` +
          `por debajo del umbral ${fmtPct(minPassRate)}.`,
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