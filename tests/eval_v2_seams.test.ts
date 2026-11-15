/**
 * Pruebas unitarias de las costuras genéricas introducidas en la Etapa 1 del Eval V2:
 * - `EngineDeps.disk` propagado a `verifyCall` (`postconditionOf`), `approvalTierOf` y `precheckCall` (`collectSources` / `checkParentFolder`).
 * - `EngineDeps.analyzeCommand` propagado a `precheckCall` dentro de `runCall` / `runTask`.
 * - `parseSnapshot` reexportado desde `src/core/ctx/index.ts`.
 * - `now?: Date` en `PROMPTS`, `stageRequests` y `QwenEngineOptions`.
 * - `MIN_COMPLETION_TOKENS`, `reserveCompletionTokens`, `buildGenerativeBody` y `StageParamsOverride`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ConfigManager, type ConfigSource, type JarvisConfig } from "../src/core/config.ts";
import type { EngineDeps, IDiscoveryEngine } from "../src/core/contracts.ts";
import { create, parseSnapshot } from "../src/core/ctx/index.ts";
import { createEngineEnv } from "../src/core/engine/env.ts";
import { collectSources, normalizeText, precheckCall, type CommandAnalyzer } from "../src/core/engine/precheck.ts";
import type { DiskView } from "../src/core/engine/postcondition.ts";
import { runTask } from "../src/core/engine/runTask.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import { verifyCall } from "../src/core/engine/verify.ts";
import type { IMCPServer } from "../src/core/mcp/types.ts";
import { PROMPTS, todayLine } from "../src/core/models/prompts.ts";
import {
  buildGenerativeBody,
  MIN_COMPLETION_TOKENS,
  QwenEngine,
  reserveCompletionTokens,
} from "../src/core/models/qwen.ts";
import {
  argumentsStageRequest,
  finalStageRequest,
  planStageRequest,
} from "../src/core/models/stageRequests.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import { toolResult } from "../src/core/tools/result.ts";
import type { MCPTool } from "../src/core/types.ts";
import { newContext } from "./fixtures.ts";

const TIMING = { start: 0, end: 0, durationMs: 0 } as never;

function testConfig(overrides: Partial<JarvisConfig> = {}): ConfigSource {
  const cfg: JarvisConfig = {
    ...ConfigManager.getConfig(),
    qwenUrl: "http://127.0.0.1:11434",
    qwenModel: "qwen3:8b",
    qwenNumCtx: 8192,
    modelKeepAlive: "10m",
    ...overrides,
  };
  return () => cfg;
}

function withFakeFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = handler as unknown as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function fakeDiscovery(servers: Record<string, { server: IMCPServer; tools: MCPTool[] }>): IDiscoveryEngine {
  return {
    getServer: (name) => servers[name]?.server,
    getDiscoveredTools: async (name) => servers[name]?.tools ?? [],
    getUnavailableServers: () => ({}),
    validateToolExists: async (name, toolName) => (servers[name]?.tools ?? []).some((t) => t.name === toolName),
  };
}

test("Etapa 1: EngineDeps.disk se propaga a verifyCall (postconditionOf) para escrituras virtuales", async () => {
  const virtualFiles = new Map<string, string>();
  const virtualDirs = new Set<string>(["/virtual", "/virtual/docs"]);
  const virtualDisk: DiskView = {
    exists: (p) => virtualDirs.has(p) || virtualFiles.has(p),
    isDirectory: (p) => virtualDirs.has(p),
    size: (p) => Buffer.byteLength(virtualFiles.get(p) ?? "", "utf8"),
    readFile: (p) => virtualFiles.get(p) ?? null,
  };

  const ctx = newContext("reactive");
  const stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "Escribir resumen", route: null, expected: null } }).ids[0];
  virtualFiles.set("/virtual/docs/resumen.txt", "ok 42");
  const callId = ctx.apply({
    op: "add",
    target: "calls",
    value: {
      stepId,
      route: "files",
      tool: "write_file",
      kind: "write",
      args: { path: "/virtual/docs/resumen.txt", content: "ok 42", mode: "rewrite" },
      sig: "sig_w",
      status: "ok",
      summary: "Wrote 5 bytes",
      ref: null,
    },
  }).ids[0];

  let verifyCalls = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-v2-seam-"));
  try {
    const deps: EngineDeps = {
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "" }),
        chooseTool: async (input) => ({ action: "tool", tool: input.tools[0], probabilities: {}, rawInput: "", rawOutput: "" }),
        reviewArgs: async () => ({ review: "approved", probabilities: {}, rawInput: "", rawOutput: "" }),
        verifyResult: async () => {
          verifyCalls++;
          return { answers: { ok: 1, cumple: 1 }, rawInput: "", rawOutput: "" };
        },
        checkCompletion: async () => ({ requestComplete: 1, rawInput: "", rawOutput: "" }),
      },
      discovery: fakeDiscovery({}),
      llm: {
        generateArgumentsFromView: async () => ({ args: {}, rawInput: "", rawOutput: "", timing: TIMING }),
        generateQuestion: async () => ({ question: "?", rawInput: "", rawOutput: "" }),
        generatePendingFromView: async () => ({ pending: [], rawInput: "", rawOutput: "" }),
        generatePlanFromView: async () => ({ steps: [], rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "ok", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir }),
      guardScope: { protectedDirs: [], relativeBases: [] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "linux", home: "/virtual", documents: "/virtual/docs" }),
      autoMode: () => true,
      disk: virtualDisk,
    };

    const env = createEngineEnv(ctx, new TaskRuntime(), deps);
    const out = await verifyCall(env, callId);
    assert.deepEqual(out, { kind: "verified", verdict: "approved", reason: null });
    assert.equal(verifyCalls, 0, "postconditionOf con virtualDisk debe aprobar sin consultar D4");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Etapa 1: precheckCall y collectSources usan disk.exists y disk.readFile inyectados", async () => {
  const virtualFiles = new Map<string, string>([
    ["/virtual/refs/r1.txt", "El archivo objetivo es /virtual/docs/destino.txt y https://ejemplo.local/dato"],
  ]);
  const virtualDirs = new Set<string>(["/virtual", "/virtual/docs"]);
  const virtualDisk: DiskView = {
    exists: (p) => virtualDirs.has(p) || virtualFiles.has(p),
    isDirectory: (p) => virtualDirs.has(p),
    size: (p) => Buffer.byteLength(virtualFiles.get(p) ?? "", "utf8"),
    readFile: (p) => virtualFiles.get(p) ?? null,
  };

  const ctx = newContext("reactive");
  const stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "Leer ref", route: null, expected: null } }).ids[0];
  const refId = ctx.apply({
    op: "add",
    target: "refs",
    value: { stepId, label: "read_file fuente", size: 99, where: "/virtual/refs/r1.txt" },
  }).ids[0];
  ctx.apply({
    op: "add",
    target: "calls",
    value: { stepId, route: "files", tool: "read_file", kind: "read", args: { path: "/virtual/docs/origen.txt" }, sig: "s1", status: "ok", summary: "ver ref", ref: refId },
  });

  const sources = collectSources(ctx, [], virtualDisk);
  assert.equal(sources.complete, true);
  assert.ok(sources.text.includes(normalizeText("/virtual/docs/destino.txt")));

  const noAnalyzer: CommandAnalyzer = async () => null;
  const okParent = await precheckCall(
    {
      tool: "write_file",
      kind: "write",
      args: { path: "/virtual/docs/nuevo.txt", content: "hola" },
      sources,
      environment: { platform: "linux", home: "/virtual", documents: "/virtual/docs" },
    },
    noAnalyzer,
    virtualDisk,
  );
  assert.equal(okParent, null, "checkParentFolder debe validar /virtual/docs con virtualDisk.exists");

  const missingParent = await precheckCall(
    {
      tool: "write_file",
      kind: "write",
      args: { path: "/virtual/no_existe_carpeta/nuevo.txt", content: "hola" },
      sources,
      environment: { platform: "linux", home: "/virtual", documents: "/virtual/docs" },
    },
    noAnalyzer,
    virtualDisk,
  );
  assert.equal(missingParent?.review, "args_invalid");
});

test("Etapa 1: EngineDeps.analyzeCommand se propaga desde runTask a precheckCall", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-v2-analyze-"));
  let analyzedCommand: string | null = null;
  const schema = { type: "object", properties: { command: { type: "string" } }, required: ["command"] };

  const makeServer = (name: string, tools: { name: string; run: () => Promise<ReturnType<typeof toolResult>> }[]) => {
    const mcpTools: MCPTool[] = tools.map((t) => ({ name: t.name, description: t.name, inputSchema: schema }));
    const server: IMCPServer = {
      name,
      version: "test",
      listTools: async () => mcpTools,
      callTool: async (toolName) => {
        const found = tools.find((t) => t.name === toolName);
        return found ? found.run() : toolResult({ text: "unknown", raw: "unknown", data: {}, isError: true });
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    return { server, tools: mcpTools };
  };

  try {
    const discovery = fakeDiscovery({
      desktop_commander: makeServer("desktop_commander", []),
      jarvis_terminal: makeServer("jarvis_terminal", [{ name: "run_command", run: async () => toolResult({ text: "ok", raw: "ok", data: { state: "finished", exitCode: 0 } }) }]),
      jarvis_web: makeServer("jarvis_web", []),
    });

    const ctx = create.context(
      { id: "analyze_seam", request: "Ejecuta Get-Date", mode: "reactive" },
      { now: () => 1_700_000_000_000, summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
    );

    let pendingRound = 0;
    const deps: EngineDeps = {
      decision: {
        firstQuery: async () => ({ kind: "single", multi: 0, probabilities: { single: 1 }, rawInput: "", rawOutput: "" }),
        chooseRoute: async () => ({ action: "route", route: "terminal", probabilities: { terminal: 1 }, rawInput: "", rawOutput: "" }),
        chooseTool: async (input) => ({ action: "tool", tool: input.tools[0], probabilities: {}, rawInput: "", rawOutput: "" }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => ({ answers: { ok: 1, cumple: 1 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 1, rawInput: "", rawOutput: "" }),
      },
      discovery,
      llm: {
        generatePendingFromView: async () => ({ pending: pendingRound++ === 0 ? ["Ejecutar Get-Date"] : [], rawInput: "", rawOutput: "" }),
        generateArgumentsFromView: async () => ({ args: { command: "Get-Date" }, rawInput: "", rawOutput: "", timing: TIMING }),
        generateQuestion: async () => ({ question: "?", rawInput: "", rawOutput: "" }),
        generatePlanFromView: async () => ({ steps: [], rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "Listo", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir }),
      guardScope: { protectedDirs: [], relativeBases: [] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana", documents: "C:\\Users\\Ana\\Documents" }),
      autoMode: () => true,
      analyzeCommand: async (cmd) => {
        analyzedCommand = cmd;
        return { syntaxErrors: [], commands: [{ name: "Get-Date", kind: "Cmdlet", dashOptions: [] }] };
      },
    };

    await runTask(ctx, new TaskRuntime(), deps);
    assert.equal(analyzedCommand, "Get-Date");
    assert.equal(ctx.task.state, "completed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Etapa 1: parseSnapshot reexportado en src/core/ctx/index.ts reconstruye snapshot válido", () => {
  const ctx = newContext("deliberative");
  const snap = ctx.snapshot();
  const parsed = parseSnapshot(snap, {
    summaryMax: 2500,
    argsStringMax: 2000,
    factValueMax: 500,
    feedbackMax: 1500,
    jsonMaxDepth: 6,
  });
  assert.equal(parsed.task.id, snap.task.id);
  const rehydrated = create.fromSnapshot(parsed, {
    now: () => 1_700_000_000_000,
    summaryMax: 2500,
    argsStringMax: 2000,
    factValueMax: 500,
    feedbackMax: 1500,
    jsonMaxDepth: 6,
  });
  assert.equal(rehydrated.n, ctx.n);
});

test("Etapa 1: now, StageParamsOverride, reserveCompletionTokens y buildGenerativeBody en QwenEngine/stageRequests", async () => {
  const fixedDate = new Date(2026, 2, 15, 12, 0, 0);
  const expectedToday = todayLine(fixedDate);
  const cfg = testConfig()();

  const planReq = planStageRequest(
    { trigger: "initial", maxSteps: 3, view: "REQUEST: probar" },
    cfg,
    PROMPTS,
    { now: fixedDate, params: { temperature: 0.42, maxTokens: 777, reasoningEffort: "medium" } },
  );
  assert.ok(planReq.user.startsWith(expectedToday) || planReq.user.includes(expectedToday));
  assert.equal(planReq.temperature, 0.42);
  assert.equal(planReq.maxTokens, 777);
  assert.equal(planReq.reasoningEffort, "medium");

  const argsReq = argumentsStageRequest(
    {
      tool: { name: "read_file", description: "Read file", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      cleanedSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      environment: { platform: "linux", home: "/tmp" },
      view: "TASK: leer",
    },
    cfg,
    PROMPTS,
    { now: fixedDate },
  );
  assert.ok(argsReq.user.startsWith(expectedToday));

  const finalReq = finalStageRequest({ view: "REQUEST: hola" }, cfg, PROMPTS, { now: fixedDate });
  assert.ok(finalReq.user.startsWith(expectedToday));

  assert.equal(MIN_COMPLETION_TOKENS, 256);
  assert.equal(reserveCompletionTokens({ system: "a".repeat(2000), user: "b".repeat(2000), maxTokens: 500 }, 500), null);
  assert.equal(reserveCompletionTokens({ system: "hola", user: "mundo", maxTokens: 500 }, 8192), 500);

  const bodyWithKeepAlive = buildGenerativeBody("qwen3:8b", planReq, 777, "10m");
  assert.deepEqual(Object.keys(bodyWithKeepAlive), [
    "model",
    "messages",
    "temperature",
    "max_tokens",
    "stream",
    "reasoning_effort",
    "keep_alive",
    "response_format",
  ]);
  assert.equal(bodyWithKeepAlive.reasoning_effort, "medium");
  assert.equal(bodyWithKeepAlive.keep_alive, "10m");

  const capturedBodies: Record<string, unknown>[] = [];
  const engine = new QwenEngine(testConfig(), PROMPTS, {
    now: () => fixedDate,
    stageParams: { final: { temperature: 0.25, maxTokens: 321, reasoningEffort: "none", thinking: false } },
  });

  await withFakeFetch(
    async (_url, init) => {
      capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Respuesta final." } }], usage: {} }), {
        status: 200,
      });
    },
    async () => {
      const out = await engine.generateFinalFromView({ view: "REQUEST: decime hoy" });
      assert.equal(out.response, "Respuesta final.");
    },
  );

  assert.equal(capturedBodies.length, 1);
  assert.equal(capturedBodies[0].temperature, 0.25);
  assert.equal(capturedBodies[0].max_tokens, 321);
  assert.equal(capturedBodies[0].reasoning_effort, "none");
  const messages = capturedBodies[0].messages as Array<{ role: string; content: string }>;
  assert.ok(messages[1].content.startsWith(expectedToday));
});
