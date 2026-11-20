/**
 * eval/core/eval_core.test.ts
 *
 * Pruebas unitarias y de integración del motor central de `eval` (`config`, `glob`,
 * `datasets`, `variants`, `graders`, `scoring`, `report`, `batch` con cliente `oracle`).
 * Ejecución: `npx tsx --test eval/core/eval_core.test.ts`
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createEvalClients, executeComparisonBatch } from "./batch.ts";
import { parseConfig, parseModelSpec } from "./config.ts";
import { loadDatasets, resolveDatasetPaths } from "./datasets.ts";
import { globBaseDir, isGlob, matchGlob, normalizePath } from "./glob.ts";
import { containsTerm, createCollector } from "./graders/common.ts";
import { ContinuationLabelGrader, D0LabelGrader, RecoveryLabelGrader, RouteLabelGrader } from "./graders/label.ts";
import { signTestP } from "./report.ts";
import { safeName } from "./results.ts";
import { computeScoreSummary, percentile } from "./scoring.ts";
import { allStageNames, isDecisionStage } from "./stages/index.ts";
import { SCHEMA_VERSION, type RunRecord } from "./types.ts";
import { listVariantNames, loadVariantSpec, parseVariantSpecs } from "./variants/load.ts";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("eval/core config y variantes", () => {
  it("parseConfig aplica defaults y parsea filtros, modelo y flags booleanos", () => {
    const cfg = parseConfig([
      "--dataset=smoke",
      "--stages=d0,continuation",
      "--variant=route_concrete_signals",
      "--model=custom-gen+custom-dec",
      "--repeat=2",
      "--concurrency=4",
      "--thinking=prod",
      "--min-pass-rate=0.85",
      "--include-shortcut",
      "--dry-run=false",
    ]);

    assert.deepEqual(cfg.datasetSpecs, ["smoke"]);
    assert.deepEqual(cfg.stages, ["d0", "continuation"]);
    assert.deepEqual(cfg.variantSpecs, ["prod", "route_concrete_signals"]);
    assert.equal(cfg.baseline, "prod");
    assert.equal(cfg.model, "custom-gen");
    assert.equal(cfg.decisionModel, "custom-dec");
    assert.equal(cfg.repeat, 2);
    assert.equal(cfg.concurrency, 4);
    assert.equal(cfg.thinking, "prod");
    assert.equal(cfg.minPassRate, 0.85);
    assert.equal(cfg.includeShortcut, true);
    assert.equal(cfg.dryRun, false);
  });

  it("parseConfig rechaza flags desconocidos, repetidos, vacíos y combinaciones inválidas", () => {
    assert.throws(() => parseConfig(["--desconocido=1"]), /Flag desconocido/);
    assert.throws(() => parseConfig(["--decision-model=x"]), /Ahora se llama/);
    assert.throws(() => parseConfig(["--limit=1", "--limit=2"]), /Flag repetido/);
    assert.throws(() => parseConfig(["--model="]), /no puede estar vacío/);
    assert.throws(() => parseConfig(["--limit=1e2"]), /entero >= 1/);
    assert.throws(() => parseConfig(["--min-pass-rate=.9"]), /decimal simple/);
    assert.throws(() => parseConfig(["--stages=,"]), /no contiene ningún valor/);
    assert.throws(() => parseConfig(["--no-baseline"]), /requiere --variant/);
    assert.throws(() => parseConfig(["--variant=d0_multi_short", "--baseline=otro"]), /no está entre las variantes/);
    assert.throws(() => parseConfig(["--client=oracle", "--variant=d0_multi_short"]), /solo vale con la variante 'prod'/);
  });

  it("parseVariantSpecs y parseModelSpec validan formatos modernos", () => {
    assert.deepEqual(parseVariantSpecs("v1,v2,v1", true), ["prod", "v1", "v2"]);
    assert.deepEqual(parseVariantSpecs("v1,v2", false), ["v1", "v2"]);
    assert.throws(() => parseVariantSpecs("v1+v2", true), /ya no existe/);
    assert.deepEqual(parseModelSpec("g1"), { model: "g1", decisionModel: parseModelSpec("+").decisionModel });
    assert.throws(() => parseModelSpec("a,b"), /más de una configuración/);
    assert.throws(() => parseModelSpec("a+b+c"), /más de un '\+'/);
  });
});

describe("eval/core glob y datasets", () => {
  it("normaliza rutas y evalúa globs *, ** y ?", () => {
    assert.equal(normalizePath(".\\eval\\datasets\\smoke.jsonl"), "eval/datasets/smoke.jsonl");
    assert.equal(isGlob("eval/datasets/*.jsonl"), true);
    assert.equal(isGlob("eval/datasets/smoke.jsonl"), false);
    assert.equal(globBaseDir("eval/datasets/**/*.jsonl"), "eval/datasets");
    assert.equal(matchGlob("eval/datasets/**/*.jsonl", "eval/datasets/smoke.jsonl"), true);
    assert.equal(matchGlob("eval/datasets/**/*.jsonl", "eval/datasets/d0/d0_variedad.jsonl"), true);
    assert.equal(matchGlob("eval/datasets/d?/d?_variedad.jsonl", "eval/datasets/d0/d0_variedad.jsonl"), true);
    assert.equal(matchGlob("eval/datasets/d?/d?_variedad.jsonl", "eval/datasets/d0/other.jsonl"), false);
  });

  it("resuelve y carga smoke.jsonl aplicando filtros", () => {
    const paths = resolveDatasetPaths(["smoke"]);
    assert.equal(paths.length, 1);
    const [all] = loadDatasets(paths);
    assert.ok(all.cases.length >= 12);

    const [onlyRoute] = loadDatasets(paths, { stages: ["route"] });
    assert.ok(onlyRoute.cases.length >= 1);
    assert.ok(onlyRoute.cases.every((c) => c.stage === "route"));

    const [limited] = loadDatasets(paths, { limit: 2 });
    assert.equal(limited.cases.length, 2);
  });
});

describe("eval/core etapas y variantes", () => {
  it("registra exactamente 14 etapas (9 decisión + 5 generativas) y carga variantes activas", async () => {
    const stages = allStageNames();
    assert.equal(stages.length, 14);
    const decisionCount = stages.filter((s) => isDecisionStage(s)).length;
    const generativeCount = stages.filter((s) => !isDecisionStage(s)).length;
    assert.equal(decisionCount, 9);
    assert.equal(generativeCount, 5);

    const prod = await loadVariantSpec("prod");
    assert.equal(prod.variant.name, "prod");
    assert.ok(prod.hash.length === 16);

    const names = listVariantNames();
    assert.ok(names.includes("prod"));
    assert.equal(names.some((n) => n.startsWith("recovery_calibrated_")), false);
  });
});

describe("eval/core graders, scoring y reporte", () => {
  it("containsTerm respeta límites de palabra, diacríticos y alternativas con |", () => {
    assert.equal(containsTerm("La versión es 12 y funciona", "12"), true);
    assert.equal(containsTerm("Hay 120 elementos", "12"), false);
    assert.equal(containsTerm("El valor es 12.5 MB", "12"), false);
    assert.equal(containsTerm("Se confirmó el envío", "rm"), false);
    assert.equal(containsTerm("Leerá los archivos", "archivo|archivos"), true);
    assert.equal(containsTerm("Texto sin acentos en informe", "informé"), true);
  });

  it("graders de decisión validan etiquetas y probabilidades mínimas/máximas", () => {
    const c1 = createCollector();
    D0LabelGrader.grade(
      { kind: "chat", probabilities: { chat: 0.9, single: 0.05, multi: 0.05 }, multi: 0.1 },
      { expectedKind: "chat", minChatProbability: 0.7 },
      { rawOutput: "", durationMs: 10 },
      c1.collector,
    );
    assert.equal(c1.passed, true);

    const c2 = createCollector();
    ContinuationLabelGrader.grade(
      { follows: true, probability: 0.8 },
      { expectedFollows: false, maxProbability: 0.3 },
      { rawOutput: "", durationMs: 10 },
      c2.collector,
    );
    assert.equal(c2.passed, false);
    assert.equal(c2.errors.length, 2);

    const c3 = createCollector();
    RouteLabelGrader.grade(
      { route: "terminal", probabilities: { terminal: 0.4 } },
      { expectedRoute: "terminal", minProbability: 0.6 },
      { rawOutput: "", durationMs: 10 },
      c3.collector,
    );
    assert.equal(c3.passed, false);

    const c4 = createCollector();
    RecoveryLabelGrader.grade(
      { action: "replan", probabilities: { replan: 0.85, close: 0.1, rewrite_item: 0.05 } },
      { expectedAction: "replan", minProbability: 0.7 },
      { rawOutput: "", durationMs: 10 },
      c4.collector,
    );
    assert.equal(c4.passed, true);
  });

  it("computeScoreSummary separa canonical vs raw y signTestP calcula p-valor exacto", () => {
    const mk = (id: string, passed: boolean, bucket: "canonical" | "raw", durationMs: number): RunRecord => ({
      schemaVersion: SCHEMA_VERSION,
      caseId: id,
      stage: "d0",
      stageKey: "d0",
      dataset: "ds",
      variant: "prod",
      model: "d3:2b",
      iteration: 1,
      bucket,
      passed,
      metrics: { client_call_ok: true },
      measurements: {},
      errors: passed ? [] : ["fail"],
      warnings: [],
      requestHash: "h1",
      rawInput: {},
      rawOutput: "",
      durationMs,
      timestamp: "2026-11-20T00:00:00.000Z",
      expectedLabel: "chat",
      predictedLabel: passed ? "chat" : "single",
    });

    const summary = computeScoreSummary([
      mk("c1", true, "canonical", 10),
      mk("c2", false, "canonical", 30),
      mk("c3", true, "raw", 999),
    ]);

    assert.equal(summary.totalRuns, 2);
    assert.equal(summary.passedRuns, 1);
    assert.equal(summary.passRate, 0.5);
    assert.equal(summary.rawTotalRuns, 1);
    assert.equal(summary.rawPassedRuns, 1);
    assert.equal(summary.avgDurationMs, 20);
    assert.equal(percentile([10, 20, 30, 40], 50), 20);
    assert.equal(signTestP(0, 0), undefined);
    assert.equal(signTestP(6, 0), 0.03125);
    assert.equal(signTestP(5, 5), 1);
    assert.equal(safeName("qwen3.5:4b/test "), "qwen3.5_4b_test");
  });
});

describe("eval/core runner + batch con cliente oracle", () => {
  it("ejecuta smoke.jsonl completo con oracle dando 100 % sin contaminar eval/results", async () => {
    const outRoot = createTempDir("eval-core-oracle-");
    const cfg = parseConfig(["--client=oracle", "--dataset=smoke", "--label=smoke_test"]);
    const [smoke] = loadDatasets(cfg.datasetSpecs);
    const prod = await loadVariantSpec("prod");
    const clients = createEvalClients(cfg);
    const datasetsByVariant = new Map([[ "prod", [smoke] ]]);

    const res = await executeComparisonBatch({
      cfg,
      variants: [{ spec: "prod", hash: prod.hash, variant: prod.variant }],
      datasetsByVariant,
      stageFilter: allStageNames(),
      clients,
      resultsRoot: outRoot,
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.cells.length, 1);
    assert.equal(res.cells[0].scores.totalRuns, smoke.cases.length);
    assert.equal(res.cells[0].scores.passRate, 1);
    assert.ok(existsSync(join(res.rootDir, "comparison.json")));
    assert.ok(existsSync(join(res.rootDir, "comparison.md")));
    assert.ok(existsSync(join(res.rootDir, "prod__smoke", "runs.jsonl")));
    assert.ok(existsSync(join(res.rootDir, "prod__smoke", "scores.json")));
    assert.ok(existsSync(join(res.rootDir, "prod__smoke", "meta.json")));

    const md = readFileSync(join(res.rootDir, "comparison.md"), "utf8");
    assert.ok(md.includes("prod"));
  });
});
