/**
 * Pruebas del modo real aislado por etapa (`--source=real-stage`, Etapa 4):
 * - Reconstrucción de trazas reales (`trace.json` y `full.json.gz`) en cualquier `seq`/`atN` preservando invariantes.
 * - Captura desde escenarios ejecutables (`captureExecutableScenario`) en sandbox aislado.
 * - Fidelidad de materialización (`VerifyDecisionInput.request === undefined`, variantes con `applyVariantPrompts`, `now`).
 * - Integración completa con `loadRealStageDatasets`, `runDataset`, `createMock*Client`, `CellWriter` y `parseConfig`.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ConfigManager } from "../src/core/config.ts";
import type { EngineDeps, EngineLLM, IActionDecision } from "../src/core/contracts.ts";
import { create, parseSnapshot } from "../src/core/ctx/index.ts";
import { runTask } from "../src/core/engine/runTask.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import { PROMPTS } from "../src/core/models/prompts.ts";
import { TaskTraceRecorder } from "../src/core/trace/recorder.ts";

import { createMockDecisionClient, createMockGenerativeClient } from "../eval/core/client/mock.ts";
import { parseConfig } from "../eval/core/config.ts";
import { createCellWriter, buildRunMeta } from "../eval/core/results.ts";
import { runDataset } from "../eval/core/runner.ts";
import { computeScoreSummary } from "../eval/core/scoring.ts";
import type { Variant } from "../eval/core/types.ts";
import { captureExecutableScenario } from "../eval/real/executableScenario.ts";
import { EVAL_CONTEXT_LIMITS } from "../eval/real/migrateSnapshot.ts";
import { loadRealStageDatasets } from "../eval/real/realStageLoader.ts";
import { materializeRealStage } from "../eval/real/realStageMaterialize.ts";
import { loadTraceFile, reconstructSnapshotAtQuery, reconstructStageFromTrace } from "../eval/real/reconstructTrace.ts";
import { createEvalSandbox } from "../eval/real/sandbox.ts";

async function produceRealTraceDir(): Promise<{ dir: string; cleanup: () => void }> {
  const sandbox = createEvalSandbox({
    files: {
      "Documents/ventas.txt": "Producto A: 120\nProducto B: 80\n",
    },
  });

  const baseCfg = ConfigManager.getConfig();
  const cfg = {
    ...baseCfg,
    traceEnabled: true,
    tracePath: join(sandbox.tracesDir, "jarvis-traces.jsonl"),
    refsDir: sandbox.refsDir,
    autoMode: true,
  };

  let clock = 1_700_000_000_000;
  const ctx = create.context(
    { id: "trace_test_task", request: "Lee ventas.txt y resume el total en resumen.txt", mode: "reactive" },
    { ...EVAL_CONTEXT_LIMITS, now: () => (clock += 500) },
  );

  let pendingCount = 0;
  let routeCount = 0;
  const recorder = new TaskTraceRecorder(ctx, () => cfg);
  const runtime = new TaskRuntime({ onChange: (w) => recorder.onWaiting(w) });

  const decision: IActionDecision = {
    async firstQuery() {
      return { kind: "multi", probabilities: { chat: 0.02, single: 0.08, multi: 0.9 }, multi: 0.9, rawInput: "", rawOutput: "" };
    },
    async continuation() {
      return { follows: 0.1, rawInput: "", rawOutput: "" };
    },
    async chooseRoute(input) {
      routeCount++;
      const route = input.routes.includes("files") ? "files" : input.routes[0];
      return { action: "route", route, probabilities: { files: 0.92, terminal: 0.05, web: 0.03 }, rawInput: "", rawOutput: "" };
    },
    async chooseTool(input) {
      const target = routeCount === 1 ? "read_file" : "write_file";
      const tool = input.tools.find((t) => t.name === target) ?? input.tools[0];
      return { action: "tool", tool, probabilities: { [tool.name]: 0.95 }, rawInput: "", rawOutput: "" };
    },
    async reviewArgs() {
      return { review: "approved", probabilities: { approved: 0.95, args_invalid: 0.03, info_missing: 0.02 }, rawInput: "", rawOutput: "" };
    },
    async verifyResult(input) {
      return { answers: { ok: input.known?.ok ?? 0.95, cumple: 0.92 }, rawInput: "", rawOutput: "" };
    },
    async probe() {
      return { probability: 0.95, rawInput: "", rawOutput: "" };
    },
    async checkCompletion() {
      return { requestComplete: 0.96, rawInput: "", rawOutput: "" };
    },
  };

  const llm: EngineLLM = {
    async generatePendingFromView(input) {
      pendingCount++;
      const list = pendingCount === 1 ? ["Leer ventas.txt en Documents", "Guardar resumen en Documentos/resumen.txt"] : [];
      return { pending: list, rawInput: input.view, rawOutput: JSON.stringify({ pending: list }) };
    },
    async generateArgumentsFromView(input) {
      const args =
        input.tool.name === "read_file"
          ? { path: join(sandbox.environment.documents!, "ventas.txt") }
          : { path: join(sandbox.environment.documents!, "resumen.txt"), content: "Total: 200", mode: "rewrite" };
      return { args, rawInput: input.view, rawOutput: JSON.stringify(args), timing: { startedAt: clock, durationMs: 1 } };
    },
    async generateQuestion(input) {
      return { question: "¿Confirmar ruta?", rawInput: input.view, rawOutput: "¿Confirmar ruta?" };
    },
    async generatePlanFromView(input) {
      return { steps: [], rawInput: input.view, rawOutput: "{}" };
    },
    async generateFinalFromView(input) {
      return { response: "Total guardado en resumen.txt: 200.", rawInput: input.view, rawOutput: "Total guardado en resumen.txt: 200." };
    },
  };

  const deps: EngineDeps = {
    decision,
    llm,
    discovery: sandbox.discovery,
    vault: sandbox.vault,
    guardScope: sandbox.guardScope,
    blacklist: sandbox.blacklist,
    environment: async () => sandbox.environment,
    autoMode: () => true,
    disk: sandbox.disk,
    analyzeCommand: sandbox.analyzeCommand,
    sink: recorder.sink,
  };

  await runTask(ctx, runtime, deps);
  await recorder.finish();

  const tracesBase = join(sandbox.tracesDir, "jarvis-traces");
  const sub = readdirSync(tracesBase, { withFileTypes: true }).find((e) => e.isDirectory());
  assert.ok(sub, "TaskTraceRecorder debió crear carpeta de traza");

  return {
    dir: join(tracesBase, sub.name),
    cleanup: () => sandbox.cleanup(),
  };
}

test("Etapa 4: parseConfig conserva modo dataset intacto y valida --source", () => {
  const dsCfg = parseConfig(["--dataset=smoke", "--client=oracle"]);
  assert.equal(dsCfg.source, "dataset");
  assert.deepEqual(dsCfg.datasetSpecs, ["smoke"]);
  assert.equal(dsCfg.client, "oracle");

  assert.throws(() => parseConfig(["--source=real-stage"]), /requiere --dataset/);
  assert.throws(() => parseConfig(["--source=otro"]), /--source: debe ser/);

  const rsCfg = parseConfig(["--source=real-stage", "--dataset=foo.jsonl", "--client=mock"]);
  assert.equal(rsCfg.source, "real-stage");
});

test("Etapa 4: reconstrucción de trazas (trace.json y full.json.gz) preserva invariantes y extrae StageTarget", async () => {
  const { dir, cleanup } = await produceRealTraceDir();
  try {
    const fullTrace = loadTraceFile(dir);
    assert.equal(fullTrace.kind, "full");
    assert.ok(fullTrace.queries.length >= 6);

    const slimTrace = loadTraceFile(join(dir, "trace.json"));
    assert.equal(slimTrace.kind, "slim");

    // Verificar reconstrucción por cada consulta en ambos formatos
    for (const q of fullTrace.queries) {
      const recon = reconstructSnapshotAtQuery(fullTrace.snapshot, q);
      assert.doesNotThrow(() => parseSnapshot(recon, EVAL_CONTEXT_LIMITS));
      if (q.stage !== "final") {
        assert.equal(recon.task.state, "running");
        assert.equal(recon.task.stopReason, null);
      }
      assert.equal(recon.result, null);
    }

    // Verify no inyecta request sintéticamente y quita veredicto de la llamada evaluada
    const verifyCapture = reconstructStageFromTrace(fullTrace, { stage: "result_verification" });
    assert.equal(verifyCapture.stage, "result_verification");
    assert.ok(verifyCapture.target.callId);
    const verifiedCall = verifyCapture.snapshot.calls.find((c) => c.id === verifyCapture.target.callId);
    assert.ok(verifiedCall);
    assert.equal(verifiedCall.verdict, null);

    const matVerify = materializeRealStage(verifyCapture);
    assert.equal(matVerify.request.type, "decision");
    if (matVerify.request.type === "decision") {
      assert.equal(matVerify.request.state.includes("REQUEST:"), false, "VerifyDecisionInput.request debe ser undefined en modo real");
    }

    // Reconstrucción sobre slim trace.json también materializa route y arguments
    const routeCap = reconstructStageFromTrace(slimTrace, { stage: "route" });
    const matRoute = materializeRealStage(routeCap);
    assert.equal(matRoute.request.type, "decision");

    const argsCap = reconstructStageFromTrace(fullTrace, { stage: "arguments" });
    const matArgs = materializeRealStage(argsCap);
    assert.equal(matArgs.request.type, "generative");
    assert.equal(matArgs.toolName, "read_file");
  } finally {
    cleanup();
  }
});

test("Etapa 4: captura ejecutable + materialización con variante y reloj + pipeline runDataset completo", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "eval-v2-real-stage-"));
  const resultsDir = join(workDir, "results");
  mkdirSync(resultsDir, { recursive: true });

  const { dir: traceDir, cleanup: cleanupTrace } = await produceRealTraceDir();
  try {
    // 1. Captura ejecutable directa al llegar a `arguments`
    const execCap = await captureExecutableScenario({
      request: "Lee informe.txt de Documentos",
      mode: "reactive",
      stopAt: { stage: "arguments", occurrence: 1 },
      files: { "Documents/informe.txt": "ventas Q1: 500" },
      now: "2026-06-15T12:00:00Z",
      script: {
        firstQueryKind: "single",
        routes: ["files"],
        tools: ["read_file"],
      },
    });
    assert.equal(execCap.stage, "arguments");
    assert.equal(typeof execCap.target.tool === "string" ? execCap.target.tool : execCap.target.tool?.name, "read_file");

    const customVariant: Variant = {
      name: "test_real_variant",
      prompts: {
        PROMPTS: {
          ARGUMENTS_VIEW: {
            ...PROMPTS.ARGUMENTS_VIEW,
            SYSTEM: "ARGS_SYSTEM_CUSTOM",
            buildSystemPrompt: () => "ARGS_SYSTEM_CUSTOM",
            buildUserPrompt: ({ tool, view, now }) => {
              const iso = (now ?? new Date()).toISOString().slice(0, 10);
              return `DATE=${iso} TOOL=${tool.name}\n${view}`;
            },
          },
        },
        DECISION_PROMPTS: {
          buildRouteChoice: ({ request }) => ({
            state: `ROUTE_CUSTOM: ${request}`,
            questions: { route: { type: "choice", instructions: "Pick route.", criteria: { files: "files", terminal: "terminal", web: "web" } } },
          }),
        },
      },
      params: {
        arguments: { temperature: 0.15, maxTokens: 512 },
      },
    };

    const matExec = materializeRealStage(execCap, customVariant);
    assert.equal(matExec.request.type, "generative");
    if (matExec.request.type === "generative") {
      assert.equal(matExec.request.system, "ARGS_SYSTEM_CUSTOM");
      assert.ok(matExec.request.user.startsWith("DATE=2026-06-15 TOOL=read_file\n"));
      assert.equal(matExec.request.temperature, 0.15);
      assert.equal(matExec.request.maxTokens, 512);
    }

    // 2. Archivo `.jsonl` con las 3 fuentes (`trace`, `frozen`, `executable`) cargado con `loadRealStageDatasets`
    const frozenCap = reconstructStageFromTrace(traceDir, { stage: "route" });
    const specFile = join(workDir, "real_stage_suite.jsonl");
    const lines = [
      JSON.stringify({
        id: "rs_trace_verify",
        kind: "trace",
        tracePath: traceDir,
        stage: "result_verification",
        expect: { expectedOk: true, expectedCumple: true },
      }),
      JSON.stringify({
        id: "rs_frozen_route",
        kind: "frozen",
        stage: "route",
        snapshot: frozenCap.snapshot,
        target: frozenCap.target,
        expect: { expectedRoute: "files" },
      }),
      JSON.stringify({
        id: "rs_exec_args",
        kind: "executable",
        executable: {
          request: "Lee informe.txt de Documentos",
          mode: "reactive",
          stopAt: { stage: "arguments", occurrence: 1 },
          files: { "Documents/informe.txt": "ventas Q1: 500" },
          now: "2026-06-15T12:00:00Z",
          script: { firstQueryKind: "single", routes: ["files"], tools: ["read_file"] },
        },
        expect: { requiredFields: ["path"] },
      }),
    ];
    writeFileSync(specFile, lines.join("\n") + "\n", "utf8");

    const datasets = await loadRealStageDatasets([specFile], {}, customVariant, false);
    assert.equal(datasets.length, 1);
    assert.equal(datasets[0].cases.length, 3);

    const routeCase = datasets[0].cases.find((c) => c.id === "rs_frozen_route")!;
    assert.equal(routeCase.request.type, "decision");
    if (routeCase.request.type === "decision") {
      assert.ok(routeCase.request.state.startsWith("ROUTE_CUSTOM:"));
    }

    // 3. Ejecución con `runDataset` + mock clients + `CellWriter` → `RunRecord` & `scores.json`
    const cfg = parseConfig(["--source=real-stage", `--dataset=${specFile}`, "--client=mock", "--repeat=1", "--concurrency=1"]);
    const genClient = createMockGenerativeClient({ url: cfg.url, model: cfg.model }, () => ({
      rawOutput: JSON.stringify({ path: "Documents/informe.txt" }),
    }));
    const decClient = createMockDecisionClient({ url: cfg.decisionUrl, model: cfg.decisionModel }, (_prepared, req) => {
      if ("route" in req.questions) {
        return JSON.stringify({ answers: { route: { choice: "files", probabilities: { files: 0.9, terminal: 0.05, web: 0.05 } } } });
      }
      return JSON.stringify({ answers: { ok: { noul: 0.95 }, cumple: { noul: 0.95 } } });
    });

    const writer = createCellWriter(resultsDir, "custom_variant", datasets[0].name);
    const out = await runDataset({
      cases: datasets[0].cases,
      datasetName: datasets[0].name,
      variant: customVariant,
      variantSpec: "custom_variant",
      cfg,
      genClient,
      decClient,
      stageFilter: [],
      onRecord: (r) => writer.writeRun(r),
    });
    writer.close(
      buildRunMeta({
        cfg,
        variantHash: "vhash",
        datasetPath: datasets[0].path,
        datasetHash: datasets[0].hash,
        stages: [],
        timestamp: new Date().toISOString(),
        caseIds: datasets[0].cases.map((c) => c.id),
      }),
    );

    assert.equal(out.allNetworkFailed, false);
    assert.equal(writer.records.length, 3);
    assert.ok(writer.records.every((r) => r.passed), `Errores inesperados: ${JSON.stringify(writer.records.map((r) => r.errors))}`);
    const scoresJson = JSON.parse(readFileSync(join(writer.cellDir, "scores.json"), "utf8")) as ReturnType<typeof computeScoreSummary>;
    assert.equal(scoresJson.passedRuns, 3);
    assert.equal(scoresJson.totalRuns, 3);
    assert.ok(existsSync(join(writer.cellDir, "runs.jsonl")));
    assert.ok(existsSync(join(writer.cellDir, "meta.json")));

    // `dryRun` con traza cruda sin archivo `.jsonl`
    const dryDatasets = await loadRealStageDatasets([traceDir], {}, undefined, true);
    assert.ok(dryDatasets[0].cases.length >= 1);
  } finally {
    cleanupTrace();
    rmSync(workDir, { recursive: true, force: true });
  }
});
