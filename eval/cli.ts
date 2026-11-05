#!/usr/bin/env node
/**
 * eval/cli.ts
 *
 * Punto de entrada del eval. Uso:
 *   npx tsx eval/cli.ts [flags]
 *
 * Secciones: 6, 7, 12.
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
import { DECISION_STAGES, GENERATIVE_STAGES } from "./core/case.ts";
import { parseConfig } from "./core/config.ts";
import { listDatasetNames, loadDatasets } from "./core/datasets.ts";
import type { InputCell } from "./core/report.ts";
import {
  generateComparisonReport,
  printComparisonSummary,
  printModelComparison,
  printQuestionSummary,
  printVariantSummary,
  writeComparison,
} from "./core/report.ts";
import { buildRunMeta, createCellWriter, newRunId, runRootDir, timestampDir } from "./core/results.ts";
import { runDataset } from "./core/runner.ts";
import { computeScoreSummary } from "./core/scoring.ts";
import { allStageNames } from "./core/stages/index.ts";
import type { ModelTarget } from "./core/targets.ts";
import { buildTargets, targetConfig, targetModelName } from "./core/targets.ts";
import type { RunRecord, StageName } from "./core/types.ts";
import { listVariantNames, loadVariantSpec } from "./core/variants/load.ts";
import type { Variant } from "./core/variants/types.ts";
import { box, c, kv, padEnd, section, sym, WIDTH, wrapList } from "./ui.ts";
import { runWizard } from "./wizard.ts";

// ───────────────────────── Consola ─────────────────────────

function log(...args: unknown[]) { console.log(...args); }
function err(...args: unknown[]) { console.error(...args); }

/** Error con el mismo formato en toda la CLI (línea en blanco previa, ✖ y texto en rojo). */
function fail(msg: string) { err(`\n${sym.err} ${c.red(msg)}`); }

function fmtPct(r: number) { return `${(r * 100).toFixed(1)}%`; }

/** Verde si pasó todo, rojo si no pasó nada, amarillo en el medio. */
function rateColor(rate: number, s: string): string {
  return rate >= 1 ? c.green(s) : rate <= 0 ? c.red(s) : c.yellow(s);
}

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

// ───────────────────────── Vistas ─────────────────────────

function printHelp(): void {
  log();
  log(box([`${c.bold(c.cyan("Eval"))} ${c.gray("·")} ${c.bold("evaluación de modelos y variantes")}`], { color: c.violet }));

  section("Uso");
  log(`  ${c.bold("npm run eval -- [flags]")}`);

  section("Opciones");
  kv([
    ["--menu", "asistente interactivo: elige modo, modelos, datasets, variantes y opciones, y ejecuta"],
    ["--list", "muestra etapas, variantes y datasets disponibles"],
    ["--help, -h", "muestra esta ayuda"],
  ]);

  section("Ejemplos");
  log(`  ${c.cyan("▌")} npm run eval -- --menu`);
  log(`  ${c.cyan("▌")} npm run eval -- --dataset=smoke --variant=prod,mi_variante`);
  log(`  ${c.cyan("▌")} npm run eval -- --source=scenario   ${c.gray("solo casos con contexto armado por Jarvis (frozen = escrito a mano)")}`);
  log(`\n  ${c.gray("Datasets y variantes se pueden escribir solo por nombre.")}`);
  log(`  ${c.gray("Referencia completa de flags:")} ${c.cyan("eval/INSTRUCCIONES.md")}\n`);
}

/** Lee un dataset para contar sus casos por etapa; `null` si no se puede cargar (no debe romper el listado). */
function datasetInfo(name: string): { total: number; scenario: number; byStage: Array<[string, number]> } | null {
  try {
    const [ds] = loadDatasets([name], {});
    if (!ds) return null;
    const by = new Map<string, number>();
    for (const k of ds.cases) by.set(k.stage, (by.get(k.stage) ?? 0) + 1);
    return { total: ds.cases.length, scenario: ds.cases.filter((k) => k.source === "scenario").length, byStage: [...by.entries()] };
  } catch {
    return null;
  }
}

/** `--list`: etapas (agrupadas), variantes (con baseline) y datasets (con cantidad de casos). */
function printList(baseline: string, defaultDatasets: string[]): void {
  const stages = allStageNames() as string[];
  const decisionSet = DECISION_STAGES as readonly string[];
  const generativeSet = GENERATIVE_STAGES as readonly string[];
  const decision = stages.filter((s) => decisionSet.includes(s));
  const generative = stages.filter((s) => generativeSet.includes(s));
  const other = stages.filter((s) => !decisionSet.includes(s) && !generativeSet.includes(s));
  const variants = listVariantNames();
  const names = listDatasetNames();

  log();
  log(
    box(
      [
        `${c.bold(c.cyan("Eval"))} ${c.gray("·")} ${c.bold("recursos disponibles")}`,
        c.gray(`${stages.length} etapas  ·  ${variants.length} variantes  ·  ${names.length} datasets`),
      ],
      { color: c.violet },
    ),
  );

  // Etapas
  section("Etapas");
  const groups: Array<[string, string[]]> = [
    ["Decisión", decision],
    ["Generativas", generative],
    ["Otras", other],
  ];
  const labelW = 13;
  for (const [label, items] of groups) {
    if (items.length === 0) continue;
    const lines = wrapList(items.map((s) => c.cyan(s)), WIDTH - 2 - labelW, c.gray(" · "));
    lines.forEach((ln, i) => log(`  ${i === 0 ? c.gray(label.padEnd(labelW)) : " ".repeat(labelW)}${ln}`));
  }

  // Variantes
  section("Variantes");
  if (variants.length === 0) {
    log(`  ${c.gray("(ninguna en eval/variants/)")}`);
  } else if (variants.length <= 10) {
    const w = Math.max(...variants.map((v) => v.length));
    for (const v of variants) {
      log(`  ${v === baseline ? sym.dot : sym.ring} ${c.cyan(v.padEnd(w))}${v === baseline ? `  ${c.green("baseline")}` : ""}`);
    }
  } else {
    for (const ln of wrapList(variants.map((v) => (v === baseline ? c.green(v) : c.cyan(v))), WIDTH - 2, c.gray(" · "))) log(`  ${ln}`);
  }
  if (variants.length > 0) log(`\n  ${c.gray("Se pueden componer con a+b, por ejemplo --variant=prod,a+b")}`);

  // Datasets
  section("Datasets");
  if (names.length === 0) {
    log(`  ${c.gray("(ninguno en eval/datasets/)")}`);
  } else {
    const infos = names.map((n) => datasetInfo(n));
    const nameW = Math.max(...names.map((n) => n.length));
    const totalW = Math.max(...infos.map((i) => (i ? String(i.total).length : 1)));
    names.forEach((name, i) => {
      const info = infos[i];
      const isDef = defaultDatasets.includes(name);
      const origin = info && info.scenario > 0 ? ` (${info.scenario === info.total ? "todos" : info.scenario} por escenario)` : "";
      const count = info ? c.gray(`${String(info.total).padStart(totalW)} casos${origin}`) : c.gray(`${"—".padStart(totalW)} (no se pudo leer)`);
      const tag = isDef ? `  ${c.green("por defecto")}` : "";
      const head = `  ${isDef ? sym.dot : sym.ring} ${c.cyan(name.padEnd(nameW))}  ${count}${tag}`;
      log(head);
      if (info && info.byStage.length > 0) {
        const breakdown = info.byStage.map(([s, n]) => `${s} ${n}`).join(" · ");
        for (const ln of wrapList([breakdown], WIDTH - nameW - 8)) log(`  ${" ".repeat(nameW + 4)}${c.gray(ln)}`);
      }
    });
  }

  // Ejemplos
  section("Ejemplo");
  log(`  ${c.cyan("▌")} npm run eval -- --dataset=<dataset> --variant=prod,<variante> --stages=<etapa>`);
  log(`  ${c.cyan("▌")} npm run eval -- --menu   ${c.gray("asistente interactivo")}\n`);
}

/** Imprime con qué configuración corre el eval (modelos, concurrencia, datasets, variantes, filtros). */
function printRunConfig(
  cfg: ReturnType<typeof parseConfig>,
  datasets: Array<{ name: string; path: string; cases: unknown[] }>,
  variants: Array<{ spec: string; chain: string[] }>,
): void {
  const list = (v: string[]) => (v.length > 0 ? v.join(", ") : "todos");
  const offline = cfg.client !== "real";
  const where = (model: string, url: string) => (offline ? `${model}  ${c.gray("(sin red)")}` : `${model}  ${c.gray(`@ ${url}`)}`);
  const rows: Array<[string, string]> = [
    ["Cliente", cfg.client === "real" ? "real" : `${c.yellow(cfg.client)} ${c.gray("(simulado, no usa modelos)")}`],
    ...(cfg.modelScope === "all" && cfg.pairs.length > 1
      ? ([["Configuraciones", cfg.pairs.map((p) => `${p.model} + ${p.decisionModel}`).join(c.gray("  |  "))]] as Array<[string, string]>)
      : ([
        [
          cfg.models.length > 1 ? "Modelos generativos" : "Modelo generativo",
          cfg.modelScope === "decision" ? c.gray("— (apagado: se eligió --d-model)") : where(cfg.models.join(", "), cfg.url),
        ],
        [
          cfg.decisionModels.length > 1 ? "Modelos de decisión" : "Modelo de decisión",
          cfg.modelScope === "generative" ? c.gray("— (apagado: se eligió --llm-model)") : where(cfg.decisionModels.join(", "), cfg.decisionUrl),
        ],
      ] as Array<[string, string]>)),
    ["Concurrencia", `${cfg.concurrency}${cfg.concurrency > 1 ? `  ${c.yellow("(la latencia p50/p95 no es comparable)")}` : ""}`],
    ["Repeticiones", String(cfg.repeat)],
    ["Thinking", cfg.thinking],
    ["Timeout", cfg.timeoutMs !== undefined ? `${cfg.timeoutMs}ms` : "default por tipo"],
    ["Variantes", variants.map((v) => (v.chain.length > 1 ? `${v.spec} ${c.gray(`[${v.chain.join(" → ")}]`)}` : v.spec)).join(", ")],
    ["Baseline", cfg.baseline],
    ["Datasets", datasets.map((d) => `${d.name} ${c.gray(`(${d.cases.length} casos)`)}`).join(", ")],
    ["Etapas", list(cfg.stages)],
    ["Filtros", `tags: ${list(cfg.tags)} | ids: ${list(cfg.ids)} | source: ${cfg.source ?? "todos"} | limit: ${cfg.limit ?? "sin límite"}`],
    ["Casos prod_shortcut", cfg.includeShortcut ? "incluidos" : "excluidos"],
  ];
  if (cfg.label) rows.push(["Label", cfg.label]);
  if (cfg.minPassRate !== undefined) rows.push(["Umbral passRate", fmtPct(cfg.minPassRate)]);
  section("Configuración");
  kv(rows);
}

/** Tabla de resumen global: una fila por celda (variante × dataset × modelo). */
function printGlobalSummary(cells: InputCell[]): void {
  const rows = cells.map((cell) => {
    const s = cell.scores;
    return {
      label: `${cell.variantSpec}/${cell.datasetName}${cell.model ? ` {${cell.model}}` : ""}`,
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
    log(
      `  ${padEnd(c.bold(r.label), labelW)}  ${rateColor(r.rate, r.pct.padStart(6))}  ${c.gray(r.counts.padStart(countW))}` +
      (r.raw ? `  ${c.gray(r.raw)}` : ""),
    );
  }
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
  let datasets;
  try {
    datasets = loadDatasets(cfg.datasetSpecs, {
      stages: cfg.stages.length > 0 ? cfg.stages : undefined,
      tags: cfg.tags.length > 0 ? cfg.tags : undefined,
      ids: cfg.ids.length > 0 ? cfg.ids : undefined,
      source: cfg.source,
      limit: cfg.limit,
    });
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
    fail("Los filtros (--stages/--tags/--ids/--source/--limit) no dejaron ningún caso para correr.");
    return 2;
  }

  // ── Cargar variantes ──
  const variantResults: Array<{ spec: string; chain: string[]; hash: string; variant: Variant; parts: Variant[] }> = [];
  for (const spec of cfg.variantSpecs) {
    try {
      const r = await loadVariantSpec(spec);
      variantResults.push({ spec, ...r });
    } catch (e) {
      fail(`Error cargando variante '${spec}': ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }

  // ── Targets: un modelo (o par generativo + decisión) por pasada ──
  const targets = buildTargets(cfg, stageFilter);
  const compareModels = targets.length > 1;

  const prepared: Array<{ target: ModelTarget; cfg: ReturnType<typeof parseConfig>; genClient: GenerativeClient; decClient: DecisionClient }> = [];
  for (const target of targets) {
    const tcfg = targetConfig(cfg, target);
    try {
      prepared.push({ target, cfg: tcfg, ...makeClients(tcfg) });
    } catch (e) {
      fail(`Error de configuración de URL generativa: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }

  // ── dry-run: solo imprime bodies y sale ──
  if (cfg.dryRun) {
    section("Dry run");
    let applyErrors = 0;
    for (const ds of datasets) {
      for (const vr of variantResults) {
        for (const p of prepared) {
          log(`\n${c.cyan("#")} variant=${c.bold(vr.spec)} dataset=${c.bold(ds.name)}${p.target.id ? ` target=${c.bold(p.target.id)}` : ""}`);
          const dry = await runDataset({
            cases: ds.cases,
            datasetName: ds.name,
            variant: vr.variant,
            variants: vr.parts,
            variantSpec: vr.spec,
            variantChain: vr.chain,
            cfg: p.cfg,
            genClient: p.genClient,
            decClient: p.decClient,
            stageFilter: p.target.stages,
            dryRun: true,
          });
          for (const r of dry.records) {
            if (r.metrics.variant_apply_ok === false) {
              applyErrors++;
              err(`  ${sym.err} ${r.caseId} ${c.gray(`[${r.variant}]`)}: ${c.red(r.errors[0] ?? "variant_apply_error")}`);
            }
          }
        }
      }
    }
    if (applyErrors > 0) {
      fail(`${applyErrors} caso(s) no pudieron aplicar la variante.`);
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
  log(`\n${c.gray("Resultados en")} ${c.cyan(rootDir)}`);

  if (compareModels) {
    log(
      `${c.gray("Comparando")} ` +
      targets
        .map((t) => `${targetModelName(t, cfg)} ${c.gray(`(${t.scope === "generative" ? "generativo" : t.scope === "decision" ? "decisión" : "completo"})`)}`)
        .join(c.gray(", ")),
    );
  }
  const comparisonCells: InputCell[] = [];
  let anyNetworkFailed = false;
  let allNetworkFailed = true;

  section("Ejecución");

  // ── Correr (variante × dataset × modelo) ──
  for (const vr of variantResults) {
    for (const ds of datasets) {
      for (const p of prepared) {
        const { target } = p;
        const modelName = compareModels ? targetModelName(target, cfg) : undefined;
        // Con varios modelos, un target solo corre los casos de sus etapas; sin ellos no hay celda que reportar.
        const cases = compareModels ? ds.cases.filter((k) => target.stages.includes(k.stage as StageName)) : ds.cases;
        if (compareModels && cases.length === 0) continue;

        log(
          `\n${c.violet("▶")} ${c.bold(vr.spec)} ${c.gray("×")} ${c.bold(ds.name)}` +
          `${modelName ? ` ${c.gray("×")} ${c.bold(modelName)}` : ""}  ${c.gray(`${cases.length} casos`)}`,
        );

        const writer = createCellWriter(rootDir, vr.spec, ds.name, target.id);
        let runCount = 0;
        let passCount = 0;

        const meta = buildRunMeta({
          cfg: p.cfg,
          variantChain: vr.chain,
          variantHash: vr.hash,
          datasetPath: ds.path,
          datasetHash: ds.hash,
          stages: target.stages,
          scope: target.scope,
          timestamp: startedAt,
          runId,
        });

        let result;
        try {
          result = await runDataset({
            cases,
            datasetName: ds.name,
            variant: vr.variant,
            variants: vr.parts,
            variantSpec: vr.spec,
            variantChain: vr.chain,
            cfg: p.cfg,
            genClient: p.genClient,
            decClient: p.decClient,
            stageFilter: target.stages,
            onRecord: (record: RunRecord) => {
              writer.writeRun(record);
              if (record.bucket === "canonical") {
                runCount++;
                if (record.passed) passCount++;
              }
              const icon = record.passed ? sym.ok : sym.err;
              const id = record.passed ? c.dim(record.caseId) : record.caseId;
              const iter = p.cfg.repeat > 1 ? c.gray(` iter=${record.iteration}`) : "";
              const bucket = record.bucket === "raw" ? c.gray(" [raw]") : "";
              log(`  ${icon} ${id} ${c.gray(`[${record.stageKey}]`)}${iter}${bucket}`);
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

        const rate = runCount > 0 ? passCount / runCount : 0;
        const pct = runCount > 0 ? rateColor(rate, fmtPct(rate)) : c.gray("—");
        log(`  ${c.gray("→")} ${c.bold(`${passCount}/${runCount}`)} pasados ${c.gray("(")}${pct}${c.gray(")")}`);
        const failedCalls = result.records.filter((r) => r.bucket === "canonical" && r.metrics.client_call_ok === false).length;
        if (failedCalls > 0) {
          log(`  ${sym.warn} ${c.yellow(`${failedCalls} de ${runCount} runs fallaron por el cliente (red/timeout/HTTP): cuentan como falla en el pass rate.`)}`);
        }

        comparisonCells.push({
          variantSpec: vr.spec,
          datasetName: ds.name,
          scores: computeScoreSummary(writer.records),
          records: writer.records,
          ...(modelName !== undefined ? { model: modelName, scope: target.scope } : {}),
        });
      }
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
  printModelComparison(comparisonReport);
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
          `${cell.variantSpec}/${cell.datasetName}${cell.model ? ` {${cell.model}}` : ""}: passRate ${cell.scores.totalRuns === 0 ? "sin runs" : fmtPct(cell.scores.passRate)} ` +
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