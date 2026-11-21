/**
 * Pruebas críticas de `ConfigManager` (aislado en carpeta temporal), `DiscoveryEngine` (caché TTL, caídos,
 * refresco forzado, `validateToolExists`, `notifyTaskEnd`) y endpoints de `jarvisRouter` / `mcpRouter` no
 * cubiertos en `http.test.ts`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import express from "express";

import { DiscoveryEngine } from "../src/core/mcp/discovery.ts";
import type { IMCPServer } from "../src/core/mcp/types.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import { readTraceFile } from "../src/core/trace/files.ts";
import { TaskManager } from "../src/core/tasks.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import type { EngineDeps } from "../src/core/contracts.ts";
import type { JarvisConfig } from "../src/core/config.ts";
import { createJarvisRouter, apiErrorHandler } from "../src/server/jarvisRouter.ts";
import { createMcpRouter } from "../src/server/mcpRouter.ts";

const TIMING = { start: 0, end: 0, durationMs: 0 } as never;

test("ConfigManager: carga archivo corrupto sin romper, normaliza campos, persiste atómico y aísla errores de onChange", async () => {
  const origCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-cfg-"));
  const cfgPath = path.join(dir, "jarvis-config.json");
  fs.writeFileSync(cfgPath, "{ json inválido", "utf-8");

  process.chdir(dir);
  try {
    const modUrl = `${pathToFileURL(path.join(origCwd, "src/core/config.ts")).href}?isolated=${Date.now()}`;
    const { ConfigManager, isKeepAlive, timeoutMap } = (await import(modUrl)) as typeof import("../src/core/config.ts");

    assert.equal(isKeepAlive("30m"), true);
    assert.equal(isKeepAlive("-1"), true);
    assert.equal(isKeepAlive("abc"), false);
    assert.deepEqual(timeoutMap({ " foo ": 500, bad: -1, zero: 0, float: 1.5, "": 100 }), { foo: 500 });

    const initial = ConfigManager.getConfig();
    assert.equal(initial.qwenModel, "qwen3.5:4b");

    // Aísla oyentes que fallan y respeta unsubscribe
    const received: boolean[] = [];
    const badUnsub = ConfigManager.onChange(() => {
      throw new Error("oyente roto");
    });
    const goodUnsub = ConfigManager.onChange((ev) => {
      received.push(ev.next.autoMode);
    });

    const updated = ConfigManager.updateConfig({
      autoMode: true,
      voiceUrl: "file:///etc/passwd", // inválido -> conserva fallback http
      modelKeepAlive: "bad_value", // inválido -> conserva fallback
      blacklist: [
        { tool: "run_command", reason: "ok", pattern: "rm" },
        { tool: "", reason: "inválido" },
      ],
      toolTimeoutsMs: { read_file: 4200, negativo: -10 },
    });

    assert.equal(updated.autoMode, true);
    assert.equal(updated.voiceUrl, "http://127.0.0.1:8880");
    assert.equal(updated.modelKeepAlive, "30m");
    assert.equal(updated.blacklist.length, 1);
    assert.deepEqual(updated.toolTimeoutsMs, { read_file: 4200 });
    assert.deepEqual(received, [true]);

    // Copia profunda: mutar lo devuelto no afecta el estado interno
    updated.autoMode = false;
    assert.equal(ConfigManager.getConfig().autoMode, true);

    // Persistencia en disco sin dejar .tmp
    assert.equal(fs.existsSync(cfgPath), true);
    assert.equal(fs.existsSync(`${cfgPath}.tmp`), false);
    const saved = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as JarvisConfig;
    assert.equal(saved.autoMode, true);

    goodUnsub();
    badUnsub();
    ConfigManager.updateConfig({ autoMode: false });
    assert.deepEqual(received, [true], "desuscrito no vuelve a recibir");
  } finally {
    process.chdir(origCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DiscoveryEngine: caché, servidores caídos con stale cache, forceRefresh, validateToolExists y notifyTaskEnd aislado", async () => {
  let listCalls = 0;
  let shouldFail = false;
  let exposedTools = [{ name: "read_file", description: "read", inputSchema: {} }];
  const endedTasks: string[] = [];

  const srvA: IMCPServer = {
    name: "srvA",
    version: "1",
    listTools: async () => {
      listCalls++;
      if (shouldFail) throw new Error("caído temporal");
      return exposedTools;
    },
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
    isConnected: () => !shouldFail,
    reconnect: async () => undefined,
    onTaskEnd: async (taskId) => {
      endedTasks.push(taskId);
    },
  };
  const srvB: IMCPServer = {
    name: "srvB",
    version: "1",
    listTools: async () => [],
    callTool: async () => ({ content: [] }),
    isConnected: () => true,
    reconnect: async () => undefined,
    onTaskEnd: async () => {
      throw new Error("fallo en cierre de srvB");
    },
  };

  const discovery = new DiscoveryEngine([srvA, srvB]);
  assert.equal((await discovery.getDiscoveredTools("srvA")).length, 1);
  assert.equal((await discovery.getDiscoveredTools("srvA")).length, 1);
  assert.equal(listCalls, 1, "hit de caché TTL");

  // Si falla tras forceRefresh, conserva caché previa y marca unavailable
  shouldFail = true;
  const cachedAfterFail = await discovery.getDiscoveredTools("srvA", true);
  assert.equal(cachedAfterFail.length, 1);
  assert.ok(discovery.getUnavailableServers().srvA);
  // Sin forceRefresh no reintenta automáticamente mientras siga marcado unavailable
  await discovery.getDiscoveredTools("srvA");
  assert.equal(listCalls, 2);

  // Recupera con forceRefresh y herramienta nueva detectada por validateToolExists
  shouldFail = false;
  exposedTools = [
    { name: "read_file", description: "read", inputSchema: {} },
    { name: "write_file", description: "write", inputSchema: {} },
  ];
  assert.equal(await discovery.validateToolExists("srvA", "write_file"), true);
  assert.equal(discovery.getUnavailableServers().srvA, undefined);
  assert.equal(await discovery.validateToolExists("srvA", "inexistente"), false);

  // notifyTaskEnd nunca lanza aunque srvB falle
  await discovery.notifyTaskEnd("t_end_1", "completed");
  assert.deepEqual(endedTasks, ["t_end_1"]);
});

test("HTTP jarvisRouter & mcpRouter: /tasks/:id, /refs/:refId, /trace, /state, /tts y /:server/*", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-http2-"));
  const tracePath = path.join(dir, "traces.jsonl");
  const vault = createRefVault({ dir: path.join(dir, "refs") });

  let calledReadTool = false;
  const fakeTools = [
    { name: "system_info", description: "read", inputSchema: {} },
    { name: "stop_process", description: "write", inputSchema: {} },
  ];
  const fakeServer: IMCPServer = {
    name: "jarvis_system",
    version: "1",
    listTools: async () => fakeTools,
    callTool: async (name) => {
      calledReadTool = name === "system_info";
      return { content: [{ type: "text", text: "archivo leido" }] };
    },
    isConnected: () => true,
    reconnect: async () => undefined,
  };
  const discovery = new DiscoveryEngine([fakeServer]);
  const getConfig = (): JarvisConfig => ({ traceEnabled: true, tracePath, qwenModel: "q", decisionModel: "d", autoMode: false }) as JarvisConfig;
  const deps: Omit<EngineDeps, "vault" | "guardScope" | "blacklist" | "environment" | "autoMode"> = {
    discovery,
    decision: {
      chooseRoute: async () => ({ action: "route", route: "files_read", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      chooseTool: async () => ({ action: "tool", tool: fakeTools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
      verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
      checkCompletion: async () => ({ requestComplete: 0.99, rawInput: "", rawOutput: "" }),
    },
    llm: {
      generatePendingFromView: async () => ({ pending: [], rawInput: "", rawOutput: "" }),
      generateArgumentsFromView: async () => ({ args: {}, rawInput: "", rawOutput: "", timing: TIMING }),
      generatePlanFromView: async () => ({ steps: [], rawInput: "", rawOutput: "" }),
      generateQuestion: async () => ({ question: "?", rawInput: "", rawOutput: "" }),
      generateFinalFromView: async () => ({ response: "ok", rawInput: "", rawOutput: "" }),
    },
  };
  const tasks = new TaskManager(deps, getConfig, {
    vault,
    guardScope: { protectedDirs: [], relativeBases: [dir] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: "linux", home: dir }),
    autoMode: () => false,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/jarvis", createJarvisRouter(tasks, discovery, () => null));
  app.use("/api/mcp", createMcpRouter(discovery));
  app.use(["/api/jarvis", "/api/mcp"], apiErrorHandler);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const started = tasks.start("sin nada", "reactive");
    await tasks.drain(3000);

    // Traza escrita por drain legible desde readTraceFile
    assert.ok(readTraceFile(tracePath, started.task.id, "summary"));
    assert.ok(readTraceFile(tracePath, started.task.id, "json"));
    assert.equal(readTraceFile(tracePath, "no_existe", "summary"), null);

    // /tasks/:id y /state
    assert.equal((await fetch(`${base}/api/jarvis/tasks/no_existe`)).status, 404);
    const taskRes = await fetch(`${base}/api/jarvis/tasks/${started.task.id}`);
    assert.equal(taskRes.status, 200);
    assert.equal(((await taskRes.json()) as { task: { id: string } }).task.id, started.task.id);

    const stateRes = await fetch(`${base}/api/jarvis/state?taskId=${started.task.id}`);
    assert.equal(stateRes.status, 200);
    assert.ok(((await stateRes.json()) as { tasks: unknown[] }).tasks.length >= 1);

    // /refs/:refId (tarea inexistente / ref inexistente)
    assert.equal((await fetch(`${base}/api/jarvis/tasks/no_existe/refs/r1`)).status, 404);
    assert.equal((await fetch(`${base}/api/jarvis/tasks/${started.task.id}/refs/r999`)).status, 404);

    // /trace validación de formato + missing
    assert.equal((await fetch(`${base}/api/jarvis/tasks/${started.task.id}/trace?format=xml`)).status, 400);
    assert.equal((await fetch(`${base}/api/jarvis/tasks/no_existe/trace?format=summary`)).status, 404);

    // /tts validaciones (400 vacío, 400 demasiado largo, 503 apagado)
    assert.equal(
      (await fetch(`${base}/api/jarvis/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "   " }) })).status,
      400,
    );
    assert.equal(
      (await fetch(`${base}/api/jarvis/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x".repeat(20001) }) })).status,
      400,
    );
    assert.equal(
      (await fetch(`${base}/api/jarvis/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hola" }) })).status,
      503,
    );

    // MCP router: status, tools, reconnect, call read ALLOW vs mutate DENY/APPROVAL (403)
    assert.deepEqual(await (await fetch(`${base}/api/mcp/jarvis_system/status`)).json(), { connected: true });
    assert.equal(((await (await fetch(`${base}/api/mcp/jarvis_system/tools`)).json()) as { tools: unknown[] }).tools.length, 2);
    assert.equal((await fetch(`${base}/api/mcp/inexistente/tools`)).status, 404);
    assert.deepEqual(await (await fetch(`${base}/api/mcp/jarvis_system/reconnect`, { method: "POST" })).json(), { ok: true });

    const badArgs = await fetch(`${base}/api/mcp/jarvis_system/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "system_info", args: ["no_objeto"] }),
    });
    assert.equal(badArgs.status, 400);

    const blockedMut = await fetch(`${base}/api/mcp/jarvis_system/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "stop_process", args: { path: path.join(dir, "x.txt"), content: "hola" } }),
    });
    assert.equal(blockedMut.status, 403);

    const allowedRead = await fetch(`${base}/api/mcp/jarvis_system/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "system_info", args: { path: path.join(dir, "x.txt") } }),
    });
    assert.equal(allowedRead.status, 200);
    assert.equal(calledReadTool, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
