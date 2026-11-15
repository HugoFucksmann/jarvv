/**
 * Pruebas unitarias e integración de la Etapa 2 del Eval V2:
 * - `fragment_judge` integrado en `STAGES`/`STAGE_KIND` y capturado en `TaskTraceRecorder` desde `WebSearchProvider` durante `runTask`.
 * - Registro completo, parsers, extractores de preguntas, materialización por escenario y graders de `probe`, `continuation` y `completion` en `eval/core/`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ConfigManager, type JarvisConfig } from "../src/core/config.ts";
import { COMPLETION_KEY, type EngineDeps, type IDiscoveryEngine } from "../src/core/contracts.ts";
import { create } from "../src/core/ctx/index.ts";
import { COMPLETION_APPROVE } from "../src/core/engine/completion.ts";
import { runTask } from "../src/core/engine/runTask.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import { CONTINUATION_APPROVE } from "../src/core/engine/thread.ts";
import type { IMCPServer } from "../src/core/mcp/types.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import type { JudgeTraceEvent } from "../src/core/tools/judge.ts";
import { GATE_MIN } from "../src/core/tools/probes.ts";
import { readTraceFile } from "../src/core/trace/files.ts";
import { TaskTraceRecorder } from "../src/core/trace/recorder.ts";
import type { MCPTool } from "../src/core/types.ts";
import { STAGE_KIND, STAGES } from "../src/core/types/stages.ts";
import { WebSearchProvider } from "../src/tools/web/webSearchProvider.ts";

import { DECISION_STAGES, validateCase } from "../eval/core/case.ts";
import { createCollector } from "../eval/core/graders/common.ts";
import { buildQuestionResults } from "../eval/core/questions.ts";
import { materializeScenario } from "../eval/core/scenario.ts";
import { computeScoreSummary } from "../eval/core/scoring.ts";
import { completionStage, continuationStage, probeStage } from "../eval/core/stages/decision.ts";
import { allStageNames, getStage, runGraders } from "../eval/core/stages/index.ts";
import type { DecisionRequest, RunRecord } from "../eval/core/types.ts";
import { SCHEMA_VERSION } from "../eval/core/types.ts";
import { groupStages } from "../eval/ui/order.ts";

const TIMING = { start: 0, end: 0, durationMs: 0 } as never;

function fakeDiscovery(servers: Record<string, { server: IMCPServer; tools: MCPTool[] }>): IDiscoveryEngine {
  return {
    getServer: (name) => servers[name]?.server,
    getDiscoveredTools: async (name) => servers[name]?.tools ?? [],
    getUnavailableServers: () => ({}),
    validateToolExists: async (name, toolName) => (servers[name]?.tools ?? []).some((t) => t.name === toolName),
  };
}

test("Etapa 2: fragment_judge está en STAGES/STAGE_KIND y WebSearchProvider lo captura en TaskTraceRecorder durante runTask", async () => {
  assert.ok(STAGES.includes("fragment_judge"));
  assert.equal(STAGE_KIND.fragment_judge, "decision");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-v2-fj-"));
  const refsDir = path.join(root, "refs");
  const tracesPath = path.join(root, "traces.jsonl");

  try {
    const searchServer: IMCPServer = {
      name: "free_search",
      version: "1.0.0",
      listTools: async () => [],
      callTool: async (toolName) => {
        if (toolName === "search") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  query: "Node.js 22 release date",
                  engines: ["duckduckgo"],
                  cached: false,
                  results: [
                    {
                      title: "Node.js 22 Released",
                      url: "https://nodejs.org/en/blog/release/v22.0.0",
                      snippet: "Node.js 22 was released on April 24, 2024.",
                      engines: ["duckduckgo"],
                      score: 0.9,
                      published_age: "2024-04-24",
                      date_source: "structured",
                    },
                  ],
                }),
              },
            ],
          };
        }
        return { content: [{ type: "text", text: "unexpected" }], isError: true };
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    };

    const hookEvents: JudgeTraceEvent[] = [];
    const webProvider = new WebSearchProvider({
      now: () => new Date(2026, 2, 15),
      onJudge: (ev) => hookEvents.push(ev),
      judge: () => ({
        score: async (need, fragments) => ({
          probabilities: fragments.map(() => 0.91),
          rawInput: JSON.stringify({ state: `QUESTION: ${need}`, questions: { f0: { type: "noul" } } }),
          rawOutput: JSON.stringify({ answers: { f0: { noul: 0.91 } } }),
          durationMs: 12,
        }),
      }),
    });

    const webTools = await webProvider.listTools();
    const emptyServer = (name: string): { server: IMCPServer; tools: MCPTool[] } => ({
      server: {
        name,
        version: "1.0.0",
        listTools: async () => [],
        callTool: async () => ({ content: [], isError: true }),
        isConnected: () => true,
        reconnect: async () => undefined,
      },
      tools: [],
    });

    const discovery = fakeDiscovery({
      free_search: { server: searchServer, tools: [] },
      jarvis_web: { server: webProvider, tools: webTools },
      desktop_commander: emptyServer("desktop_commander"),
      jarvis_terminal: emptyServer("jarvis_terminal"),
    });

    const ctx = create.context(
      { id: "fj_trace_task", request: "¿Cuándo salió Node.js 22?", mode: "reactive" },
      { now: () => 1_700_000_000_000, summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
    );

    const cfg: JarvisConfig = {
      ...ConfigManager.getConfig(),
      traceEnabled: true,
      tracePath: tracesPath,
      qwenModel: "qwen3:8b",
      decisionModel: "d3:2b",
    };

    const recorder = new TaskTraceRecorder(ctx, () => cfg);
    let pendingRound = 0;

    const deps: EngineDeps = {
      decision: {
        firstQuery: async () => ({ kind: "single", multi: 0, probabilities: { single: 1 }, rawInput: "{}", rawOutput: "{}" }),
        chooseRoute: async () => ({ action: "route", route: "web", probabilities: { web: 1 }, rawInput: "{}", rawOutput: "{}" }),
        chooseTool: async (input) => ({ action: "tool", tool: input.tools[0], probabilities: { web_search: 1 }, rawInput: "{}", rawOutput: "{}" }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "{}", rawOutput: "{}" }),
        verifyResult: async () => ({ answers: { ok: 1, cumple: 0.95 }, rawInput: "{}", rawOutput: "{}" }),
        checkCompletion: async () => ({ requestComplete: 0.95, rawInput: "{}", rawOutput: "{}" }),
      },
      discovery,
      llm: {
        generatePendingFromView: async () => ({ pending: pendingRound++ === 0 ? ["Buscar fecha de lanzamiento de Node.js 22"] : [], rawInput: "{}", rawOutput: "{}" }),
        generateArgumentsFromView: async () => ({ args: { need: "When was Node.js 22 released?" }, rawInput: "{}", rawOutput: "{}", timing: TIMING }),
        generateQuestion: async () => ({ question: "?", rawInput: "{}", rawOutput: "{}" }),
        generatePlanFromView: async () => ({ steps: [], rawInput: "{}", rawOutput: "{}" }),
        generateFinalFromView: async () => ({ response: "Node.js 22 salió el 24 de abril de 2024.", rawInput: "{}", rawOutput: "{}" }),
      },
      vault: createRefVault({ dir: refsDir }),
      guardScope: { protectedDirs: [], relativeBases: [] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "linux", home: "/tmp/home" }),
      autoMode: () => true,
      sink: recorder.sink,
    };

    await runTask(ctx, new TaskRuntime(), deps);
    await recorder.finish();

    assert.equal(ctx.task.state, "completed");
    assert.equal(hookEvents.length, 1);

    const traceJson = JSON.parse(readTraceFile(tracesPath, ctx.task.id, "json") ?? "null") as {
      queries: Array<{ stage: string; link: { call: string | null }; output: unknown }>;
    };
    const fullJson = JSON.parse(readTraceFile(tracesPath, ctx.task.id, "full") ?? "null") as {
      models: Array<{ stage: string; link: { call: string | null }; input: string | null; output: string | null }>;
    };

    const callId = ctx.find("calls", {})[0]?.id;
    assert.ok(callId);

    const slimJudge = traceJson.queries.filter((q) => q.stage === "fragment_judge");
    const fullJudge = fullJson.models.filter((m) => m.stage === "fragment_judge");
    assert.equal(slimJudge.length, 1);
    assert.equal(fullJudge.length, 1);
    assert.equal(slimJudge[0].link.call, callId);
    assert.equal(fullJudge[0].link.call, callId);
    assert.ok(fullJudge[0].input?.includes("When was Node.js 22 released?"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Etapa 2: probe, continuation y completion están registrados de forma exhaustiva en eval/core", () => {
  const registered = allStageNames();
  for (const s of ["probe", "continuation", "completion"] as const) {
    assert.ok((DECISION_STAGES as readonly string[]).includes(s), `${s} debe estar en DECISION_STAGES`);
    assert.ok(registered.includes(s), `${s} debe estar en REGISTRY`);
    assert.equal(getStage(s).requestType, "decision");
  }
  const decisionGroup = groupStages().find(([name]) => name === "Decisión")?.[1] ?? [];
  assert.ok(decisionGroup.includes("probe"));
  assert.ok(decisionGroup.includes("continuation"));
  assert.ok(decisionGroup.includes("completion"));
});

test("Etapa 2: materialización, validación, parseo, preguntas y graders de probe, continuation y completion", () => {
  // 1. probe desde el catálogo real (`PLACE_PROBE`)
  const probeMat = materializeScenario("probe", {
    mode: "reactive",
    request: "Guarda nota.txt en Documentos",
    calls: [
      {
        route: "files",
        tool: "write_file",
        kind: "write",
        status: "ok",
        args: { path: "C:/Users/hugof/Downloads/nota.txt", content: "hola", mode: "rewrite" },
        summary: "Successfully wrote to C:/Users/hugof/Downloads/nota.txt",
      },
    ],
    at: { probe: "place", probeStage: 0 },
  });
  const probeCaseRes = validateCase({
    id: "probe-place-1",
    stage: "probe",
    request: probeMat.request,
    expect: { expectedYes: false, maxProbability: 0.4 },
  });
  assert.equal(probeCaseRes.ok, true);
  const probeReq = probeMat.request as DecisionRequest;
  assert.equal(probeStage.parseOutput(JSON.stringify({ answers: { probe: { noul: GATE_MIN - 0.05 } } }), probeReq).yes, false);
  const probeOut = probeStage.parseOutput(JSON.stringify({ answers: { probe: { noul: 0.15 } } }), probeReq);
  assert.deepEqual(probeOut, { yes: false, probability: 0.15 });
  const probeCol = createCollector();
  runGraders(probeStage, probeOut, { expectedYes: false, maxProbability: 0.4 }, { rawOutput: "{}", durationMs: 10 }, probeCol.collector);
  assert.equal(probeCol.passed, true);

  // 2. continuation (`CONTINUATION_APPROVE = 0.3`)
  const contMat = materializeScenario("continuation", {
    mode: "reactive",
    request: "Guardalo en un archivo md",
    at: { previousTask: { request: "Busca info de TypeScript 5", answer: "TS 5 salió..." } },
  });
  const contCaseRes = validateCase({
    id: "cont-1",
    stage: "continuation",
    request: contMat.request,
    expect: { expectedFollows: true, minProbability: 0.3 },
  });
  assert.equal(contCaseRes.ok, true);
  const contReq = contMat.request as DecisionRequest;
  const contRaw = JSON.stringify({ answers: { follow: { noul: CONTINUATION_APPROVE } } });
  const contOut = continuationStage.parseOutput(contRaw, contReq);
  assert.deepEqual(contOut, { follows: true, probability: CONTINUATION_APPROVE });
  const contQuestions = buildQuestionResults({
    rawOutput: contRaw,
    sentReq: contReq,
    stage: "continuation",
    expect: { expectedFollows: true },
    canonicalExpected: null,
  });
  assert.equal(contQuestions.follow.role, "main");
  assert.equal(contQuestions.follow.answer, "yes");
  assert.equal(contQuestions.follow.correct, true);

  // 3. completion (`COMPLETION_APPROVE = 0.75`)
  const compMat = materializeScenario("completion", {
    mode: "reactive",
    request: "Lee notas.txt y decime cuántas líneas tiene",
    calls: [
      {
        route: "files",
        tool: "read_file",
        kind: "read",
        status: "ok",
        verdict: "approved",
        args: { path: "C:/Users/hugof/notas.txt" },
        summary: "linea 1\nlinea 2",
      },
    ],
  });
  const compCaseRes = validateCase({
    id: "comp-1",
    stage: "completion",
    request: compMat.request,
    expect: { expectedComplete: false, maxProbability: 0.7 },
  });
  assert.equal(compCaseRes.ok, true);
  const compReq = compMat.request as DecisionRequest;
  assert.ok(COMPLETION_KEY in compReq.questions);
  const compRaw = JSON.stringify({ answers: { [COMPLETION_KEY]: { noul: COMPLETION_APPROVE - 0.1 } } });
  const compOut = completionStage.parseOutput(compRaw, compReq);
  assert.equal(compOut.complete, false);
  const compCol = createCollector();
  runGraders(completionStage, compOut, { expectedComplete: false, maxProbability: 0.7 }, { rawOutput: compRaw, durationMs: 15 }, compCol.collector);
  assert.equal(compCol.passed, true);
  const compQuestions = buildQuestionResults({
    rawOutput: compRaw,
    sentReq: compReq,
    stage: "completion",
    expect: { expectedComplete: false },
    canonicalExpected: null,
  });
  assert.equal(compQuestions[COMPLETION_KEY].answer, "no");
  assert.equal(compQuestions[COMPLETION_KEY].correct, true);

  // 4. Validación de coherencia de rangos y scoring
  const invalidExpect = validateCase({
    id: "comp-bad",
    stage: "completion",
    request: compMat.request,
    expect: { expectedComplete: true, minProbability: 0.8, maxProbability: 0.5 },
  });
  assert.equal(invalidExpect.ok, false);

  const rec: RunRecord = {
    schemaVersion: SCHEMA_VERSION,
    dataset: "stage2-test",
    caseId: "comp-1",
    stage: "completion",
    stageKey: "completion",
    iteration: 1,
    variant: "prod",
    model: "d3:2b",
    passed: true,
    bucket: "canonical",
    errors: [],
    warnings: [],
    metrics: { client_call_ok: true },
    measurements: {},
    predictedLabel: "no",
    expectedLabel: "no",
    requestHash: "abc",
    rawInput: compReq,
    rawOutput: compRaw,
    durationMs: 15,
    timestamp: new Date().toISOString(),
  };
  const score = computeScoreSummary([rec]);
  assert.equal(score.stages.completion.accuracy, 1);
  assert.equal(score.stages.completion.passRate, 1);
});
