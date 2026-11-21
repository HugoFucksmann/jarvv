/**
 * eval/core/eval_core.test.ts
 *
 * Pruebas unitarias y de integración del motor central de `eval` (`config`, `glob`,
 * `datasets`, `variants`, `graders`, `scoring`, `report`, `batch` con cliente `oracle`).
 * Ejecución: `npx tsx --test eval/core/eval_core.test.ts`
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { createEvalClients, executeComparisonBatch } from "./batch.ts";
import { createDecisionClient } from "./client/decision.ts";
import { createMockGenerativeClient } from "./client/mock.ts";
import { parseConfig, parseModelSpec } from "./config.ts";
import { loadDatasets, resolveDatasetPaths } from "./datasets.ts";
import { globBaseDir, isGlob, matchGlob, normalizePath } from "./glob.ts";
import { containsTerm, createCollector } from "./graders/common.ts";
import { ContinuationLabelGrader, D0LabelGrader, RecoveryLabelGrader, RouteLabelGrader } from "./graders/label.ts";
import { signTestP } from "./report.ts";
import { evaluatedModelDirName, runRootDir, safeName } from "./results.ts";
import { runDataset } from "./runner.ts";
import { computeScoreSummary, percentile } from "./scoring.ts";
import { allStageNames, isDecisionStage } from "./stages/index.ts";
import { SCHEMA_VERSION, type RunRecord } from "./types.ts";
import { listVariantNames, loadVariantSpec, parseVariantSpecs } from "./variants/load.ts";
import { printGlobalSummary } from "../ui/views/run.ts";
import { parseCrossConfig, runCrossCli } from "../cross.ts";
import { materializeScenario } from "./scenario.ts";
import { convertTraces } from "./traces.ts";
import { parseTracesConfig, runTracesCli } from "../traces.ts";

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
    const split = parseConfig(["--decision-model=dec-x", "--generative-model=gen-y"]);
    assert.equal(split.decisionModel, "dec-x");
    assert.equal(split.model, "gen-y");
    const merged = parseConfig(["--model=gen-only+", "--decision-model=dec-y"]);
    assert.equal(merged.model, "gen-only");
    assert.equal(merged.decisionModel, "dec-y");

    assert.throws(() => parseConfig(["--desconocido=1"]), /Flag desconocido/);
    assert.throws(() => parseConfig(["--d-model=x"]), /Ahora se llama/);
    assert.throws(() => parseConfig(["--model=g1+d1", "--decision-model=d2"]), /entra en conflicto/);
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
    for (const archived of [
      "pending2",
      "pending2_obj",
      "pending2_exp",
      "d5_it6_move_aware_choice",
      "d5_it7_apex_choice",
      "d5_it8_apex_calibrated",
      "fragment_judge_ternary",
      "args_review_choice_plus_probe",
    ]) {
      assert.equal(names.includes(archived), false, `archivada '${archived}' no debe listarse como activa`);
    }

    // Todas las variantes activas listadas cargan con nombre y forma válidos
    for (const activeName of names) {
      const loaded = await loadVariantSpec(activeName);
      assert.equal(loaded.variant.name, activeName);
      assert.equal(loaded.hash.length, 16);
    }

    // Carga de .jsonl con finales CRLF (\r\n)
    const crlfDir = createTempDir("eval-crlf-");
    const crlfFile = join(crlfDir, "crlf_smoke.jsonl");
    const firstSmokeLine = readFileSync(resolveDatasetPaths(["smoke"])[0], "utf8")
      .split(/\r?\n/)
      .find((l) => l.trim() !== "" && !l.trim().startsWith("#"));
    assert.ok(firstSmokeLine);
    writeFileSync(crlfFile, `${firstSmokeLine}\r\n`, "utf8");
    const [loadedCrlf] = loadDatasets([crlfFile]);
    assert.equal(loadedCrlf.cases.length, 1);
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

  it("valida URL vacía en createDecisionClient, trata config: como fatal en runner y usa decisionModel en runRootDir", async () => {
    assert.throws(() => createDecisionClient({ url: "   ", model: "d3:2b" }), /Decision 2\.0/);

    const decCfg = parseConfig(["--stages=d0", "--model=gen-m+dec:2b"]);
    assert.equal(evaluatedModelDirName(decCfg), "dec_2b");
    assert.match(runRootDir(decCfg, "2026-11-19_120000"), /^eval\/results\/dec_2b\//);

    const genCfg = parseConfig(["--stages=plan", "--model=gen-m+dec:2b"]);
    assert.equal(evaluatedModelDirName(genCfg), "gen-m");
    assert.match(runRootDir(genCfg, "2026-11-19_120000"), /^eval\/results\/gen-m\//);

    const [d0Ds] = loadDatasets(resolveDatasetPaths(["d0_variedad"]), { stages: ["d0"] });
    assert.ok(d0Ds.cases.length >= 1);
    const prod = await loadVariantSpec("prod");
    const runOut = await runDataset({
      cases: d0Ds.cases.slice(0, 1),
      datasetName: d0Ds.name,
      variant: prod.variant,
      variantSpec: "prod",
      cfg: decCfg,
      genClient: createMockGenerativeClient({ url: decCfg.url, model: decCfg.model }),
      decClient: {
        prepare: (req) => ({ url: "http://127.0.0.1:11434/v1/systemone", body: { state: req.state, questions: req.questions } }),
        call: async () => ({ ok: false, error: "config: missing decision url", durationMs: 0 }),
      },
      stageFilter: ["d0"],
    });
    assert.equal(runOut.allNetworkFailed, true);

    assert.doesNotThrow(() => printGlobalSummary([]));
  });

  it("cross.ts rechaza flags desconocidos/vacíos, soporta --help y recovery exige que at.attempts coincida con pasos fallidos seguidos", async () => {
    assert.throws(() => parseCrossConfig(["--unknown=1"]), /Flag desconocido/);
    assert.throws(() => parseCrossConfig(["--dataset="]), /no puede estar vacío/);
    assert.throws(() => parseCrossConfig(["--baseline=prod", "--baseline=otro"]), /Flag repetido/);

    const origLog = console.log;
    const origErr = console.error;
    let out = "";
    console.log = (...args: unknown[]) => {
      out += args.map(String).join(" ") + "\n";
    };
    console.error = (...args: unknown[]) => {
      out += args.map(String).join(" ") + "\n";
    };
    try {
      assert.equal(await runCrossCli(["--help"]), 0);
      assert.match(out, /eval:cross/);
      assert.equal(await runCrossCli(["--typo-flag=1"]), 2);
      assert.equal(await runCrossCli(["--runs=eval/results/no-existe-esta-carpeta"]), 2);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    assert.throws(
      () =>
        materializeScenario("recovery", {
          mode: "reactive",
          request: "Buscar archivo",
          steps: [{ instruction: "Leer archivo", state: "failed" }],
          calls: [{ route: "files", tool: "read_file", kind: "read", status: "tool_error", summary: "ENOENT", verdict: "rejected", reason: "no_usable_data" }],
          at: { previous: ["Leer archivo"], cause: "tool_failed", attempts: 2 },
        }),
      /pasos fallidos seguidos/,
    );

    const aligned = materializeScenario("recovery", {
      mode: "reactive",
      request: "Buscar archivo",
      steps: [
        { instruction: "Leer archivo", state: "failed" },
        { instruction: "Leer archivo", state: "failed" },
      ],
      calls: [
        { step: 0, route: "files", tool: "read_file", kind: "read", status: "tool_error", summary: "ENOENT", verdict: "rejected", reason: "no_usable_data" },
        { step: 1, route: "files", tool: "read_file", kind: "read", status: "tool_error", summary: "ENOENT", verdict: "rejected", reason: "no_usable_data" },
      ],
      at: { previous: ["Leer archivo"], cause: "tool_failed", attempts: 2 },
    });
    assert.equal(aligned.request.type, "decision");
    assert.match(aligned.request.state, /Attempts so far: 2/);
  });

  it("D8: arguments deriva priorAttempts de llamadas previas no aprobadas y respeta at.priorAttempts en temperatura", () => {
    const schema = {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false,
    };

    const t0 = materializeScenario("arguments", {
      mode: "reactive",
      request: "Listar procesos",
      steps: [{ state: "running" }],
      at: { route: "terminal", tool: "run_command", inputSchema: schema },
    });
    assert.equal(t0.request.type, "generative");
    if (t0.request.type === "generative") assert.equal(t0.request.temperature, 0.1);

    const t1 = materializeScenario("arguments", {
      mode: "reactive",
      request: "Listar procesos",
      steps: [{ state: "running" }],
      calls: [
        { route: "terminal", tool: "run_command", status: "ok", args: { command: "ps" }, verdict: "rejected", reason: "not_accomplished" },
      ],
      at: { route: "terminal", tool: "run_command", inputSchema: schema },
    });
    assert.equal(t1.request.type, "generative");
    if (t1.request.type === "generative") assert.equal(t1.request.temperature, 0.3);

    const t2 = materializeScenario("arguments", {
      mode: "reactive",
      request: "Listar procesos",
      steps: [{ state: "running" }],
      at: { route: "terminal", tool: "run_command", inputSchema: schema, priorAttempts: 2 },
    });
    assert.equal(t2.request.type, "generative");
    if (t2.request.type === "generative") assert.equal(t2.request.temperature, 0.5);

    // waiting_input no cuenta como intento previo fallido
    const tWaiting = materializeScenario("arguments", {
      mode: "reactive",
      request: "Responder prompt",
      steps: [{ state: "running" }],
      calls: [{ route: "terminal", tool: "run_command", status: "waiting_input", args: { command: "node script.js" } }],
      at: { route: "terminal", tool: "run_command", inputSchema: schema },
    });
    assert.equal(tWaiting.request.type, "generative");
    if (tWaiting.request.type === "generative") assert.equal(tWaiting.request.temperature, 0.1);

    // Validación de valor inválido en at.priorAttempts
    assert.throws(
      () =>
        materializeScenario("arguments", {
          mode: "reactive",
          request: "Listar procesos",
          steps: [{ state: "running" }],
          at: { route: "terminal", tool: "run_command", inputSchema: schema, priorAttempts: -1 },
        }),
      /priorAttempts/,
    );

    // Dataset real existente con 2 intentos previos fallidos
    const [blockedDs] = loadDatasets(resolveDatasetPaths(["args_blocked_repeat"]));
    assert.ok(blockedDs.cases.length >= 1);
    for (const c of blockedDs.cases) {
      assert.equal(c.request.type, "generative");
      if (c.request.type === "generative") assert.equal(c.request.temperature, 0.5);
    }
  });

  it("traces.ts convierte jarvis-traces/ (trace.json + full.json.gz) a .jsonl validados y ejecutables por oracle", async () => {
    const tracesRoot = createTempDir("eval-traces-in-");
    const taskDir = join(tracesRoot, "20261119-120000_t1");
    const outDir = createTempDir("eval-traces-out-");
    mkdirSync(taskDir, { recursive: true });

    const runCmdSchema = {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false,
    };

    const slimTrace = {
      v: 3,
      taskId: "t1",
      meta: {
        formatVersion: 3,
        gitSha: "abc1234",
        environment: {
          home: "C:\\Users\\Alice",
          desktop: "C:\\Users\\Alice\\Desktop",
          documents: "C:\\Users\\Alice\\Documents",
          downloads: "C:\\Users\\Alice\\Downloads",
        },
        toolSchemas: { run_command: runCmdSchema },
      },
      snapshot: {
        v: 1,
        task: {
          id: "t1",
          mode: "reactive",
          request: "Listá los archivos de C:\\Users\\Alice\\Documents y decime cuántos son",
          state: "completed",
          stopReason: null,
          startedAt: 1000,
        },
        plans: [],
        steps: [
          { id: "s1", at: 1050, planId: null, instruction: "Listar Documentos", route: null, expected: null, state: "failed", superseded: false },
          { id: "s2", at: 2000, planId: null, instruction: "Contar archivos en Documentos", route: null, expected: null, state: "completed", superseded: false },
        ],
        calls: [
          {
            id: "c1",
            stepId: "s1",
            at: 1200,
            route: "terminal",
            tool: "run_command",
            kind: "read",
            args: { command: "badcmd" },
            sig: "sig1",
            status: "tool_error",
            verdict: "rejected",
            reason: "no_usable_data",
            summary: "Command not found",
            ref: null,
          },
          {
            id: "c2",
            stepId: "s2",
            at: 2200,
            route: "terminal",
            tool: "run_command",
            kind: "read",
            args: { command: "Get-ChildItem C:\\Users\\Alice\\Documents" },
            sig: "sig2",
            status: "ok",
            verdict: "approved",
            reason: null,
            summary: "3 files found",
            ref: null,
          },
        ],
        errors: [],
        facts: {},
        refs: [],
        recalled: [
          { id: "rec1", at: 1005, stepId: null, source: "thread", key: "previous_request", value: "Qué hay en Escritorio?", from: "t0" },
          { id: "rec2", at: 1006, stepId: null, source: "thread", key: "previous_answer", value: "Hay 2 carpetas.", from: "t0" },
        ],
        result: { text: "Hay 3 archivos en Documents.", origin: "model" },
      },
      queries: [
        { seq: 1, stage: "continuation", step: null, n: 1, startedAt: 1010, output: { follow: { noul: 0.1 } }, error: null, link: { call: null, plan: null, fact: null, result: false }, inputHash: "h1" },
        { seq: 2, stage: "first_query", step: null, n: 1, startedAt: 1020, output: { kind: { choice: "single", p: { chat: 0.02, single: 0.9, multi: 0.08 } }, multi: { noul: 0.1 } }, error: null, link: { call: null, plan: null, fact: null, result: false }, inputHash: "h2" },
        { seq: 3, stage: "route", step: "s1", n: 2, startedAt: 1100, offered: ["files", "terminal", "web"], output: { route: { choice: "terminal", p: { terminal: 0.9 } } }, error: null, link: { call: "c1", plan: null, fact: null, result: false }, inputHash: "h3" },
        { seq: 4, stage: "tool", step: "s1", n: 2, startedAt: 1120, offered: ["run_command", "list_processes", "stop_process"], output: { selected_tool: { choice: "run_command", p: { run_command: 0.9 } } }, error: null, link: { call: "c1", plan: null, fact: null, result: false }, inputHash: "h4" },
        { seq: 5, stage: "args", step: "s1", n: 2, startedAt: 1150, offered: null, output: { command: "badcmd" }, error: null, link: { call: "c1", plan: null, fact: null, result: false }, inputHash: "h5" },
        { seq: 6, stage: "verify", step: "s1", n: 3, startedAt: 1250, offered: ["ok", "cumple"], output: { ok: { noul: 0.1 }, cumple: { noul: 0.05 } }, error: null, link: { call: "c1", plan: null, fact: null, result: false }, inputHash: "h6" },
        { seq: 7, stage: "recovery", step: "s1", n: 4, startedAt: 1300, offered: null, output: { action: { choice: "rewrite_item", p: { rewrite_item: 0.8 } } }, error: null, link: { call: null, plan: null, fact: null, result: false }, inputHash: "h7" },
        { seq: 8, stage: "pending", step: null, n: 5, startedAt: 2300, offered: null, output: { pending: [] }, error: null, link: { call: null, plan: null, fact: null, result: false }, inputHash: "h8" },
        { seq: 9, stage: "completion", step: null, n: 5, startedAt: 2350, offered: null, output: { request_complete: { noul: 0.92 } }, error: null, link: { call: null, plan: null, fact: null, result: false }, inputHash: "h9" },
        { seq: 10, stage: "final", step: null, n: 6, startedAt: 2400, offered: null, output: "Hay 3 archivos en Documents.", error: null, link: { call: null, plan: null, fact: null, result: true }, inputHash: "h10" },
      ],
      tools: [{ call: "c2", mcp: "jarvis_terminal", tool: "run_command", args: { command: "Get-ChildItem C:\\Users\\Alice\\Documents" }, resultHead: "3 files", ref: null, error: null }],
    };

    const fullTrace = {
      v: 3,
      kind: "full",
      models: [
        {
          seq: 7,
          stage: "recovery",
          input: JSON.stringify({
            state: "REQUEST:\nList\n\nPENDING:\n1. Listar Documentos\n\n### THE STEP THAT JUST FAILED\nItem: Listar Documentos\nWhy it failed: tool_failed\nAttempts so far: 1\nItems after it: none",
          }),
        },
        {
          seq: 8,
          stage: "pending",
          input: JSON.stringify({
            messages: [{ role: "user", content: "REQUEST:\nList\n\nPENDING:\n1. Contar archivos en Documentos" }],
          }),
        },
      ],
    };

    writeFileSync(join(taskDir, "trace.json"), JSON.stringify(slimTrace), "utf8");
    writeFileSync(join(taskDir, "full.json.gz"), gzipSync(Buffer.from(JSON.stringify(fullTrace), "utf8")));

    const outJsonl = join(outDir, "from_traces.jsonl");
    const conv = convertTraces({ inputPath: tracesRoot, outPath: outJsonl, anonymize: true });
    assert.equal(conv.filesScanned, 1);
    assert.equal(conv.cases.length, 10);
    assert.equal(conv.skipped.length, 0);
    assert.equal(existsSync(outJsonl), true);

    const text = readFileSync(outJsonl, "utf8");
    assert.equal(text.includes("Alice"), false, "anonymize debe ocultar el usuario");
    assert.equal(conv.cases.some((c) => c.scenario.request.includes("C:\\Users\\usuario")), true);

    // Verificar que los casos convertidos cargan y pasan 100 % con oracle
    const [loaded] = loadDatasets([outJsonl]);
    assert.equal(loaded.cases.length, 10);
    const oracleRoot = createTempDir("eval-traces-oracle-");
    const cfg = parseConfig(["--client=oracle", "--label=traces_oracle"]);
    const prod = await loadVariantSpec("prod");
    const batch = await executeComparisonBatch({
      cfg,
      variants: [{ spec: "prod", hash: prod.hash, variant: prod.variant }],
      datasetsByVariant: new Map([["prod", [loaded]]]),
      stageFilter: allStageNames(),
      clients: createEvalClients(cfg),
      resultsRoot: oracleRoot,
    });
    assert.equal(batch.ok, true);
    if (batch.ok) assert.equal(batch.cells[0].scores.passRate, 1);

    // CLI config + flags + help
    assert.throws(() => parseTracesConfig(["--unknown=1"]), /Flag desconocido/);
    assert.equal(await runTracesCli(["--help"]), 0);
    assert.equal(await runTracesCli(["--input=" + join(tracesRoot, "no-existe")]), 2);
    assert.equal(await runTracesCli([`--input=${tracesRoot}`, `--out=${outJsonl}`, "--dry-run"]), 0);
  });
});
