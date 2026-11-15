/**
 * Invariantes del motor (`src/core/engine/`, Fase 2 de auditoría).
 *
 * - Invariante 1: Solo `runTask`/`finalize` escribe el estado terminal y `result` (y ante defecto interno, `TaskManager.closeOnDefect`).
 * - Invariante 4 y 5 (flujo completo): Un replan deliberativo no repite ni sustituye pasos `completed`, y `effects()` previos sobreviven.
 * - Invariante 6 y 7: Toda herramienta se despacha tras Guard; con Guard `DENY` (incl. Regla B por ruta abs/rel y `/etc/shadow`), el proveedor nunca es invocado.
 * - Invariante 8: Refs estrictamente aisladas a la tarea activa (`refs_unresolved` en `runCall` y `TaskManager.readRef`).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

import type { JarvisConfig } from "../src/core/config.ts";
import type { EngineDeps, EngineLLM, IActionDecision, IDiscoveryEngine } from "../src/core/contracts.ts";
import { create } from "../src/core/ctx/index.ts";
import type { TaskContext, TaskMode } from "../src/core/ctx/index.ts";
import { runTask } from "../src/core/engine/runTask.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import type { EngineServices } from "../src/core/engine/services.ts";
import type { IMCPServer } from "../src/core/mcp/types.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { Guard } from "../src/core/policy/guard.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import { TaskManager } from "../src/core/tasks.ts";
import type { MCPCallResult, MCPTool } from "../src/core/types.ts";
import { createMcpRouter } from "../src/server/mcpRouter.ts";
import type { DiscoveryEngine } from "../src/core/mcp/discovery.ts";

const TIMING = { start: 0, end: 0, durationMs: 0 } as never;
const SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string" },
    mode: { type: "string" },
    command: { type: "string" },
  },
};
const FILE_TOOLS: MCPTool[] = ["list_directory", "read_file", "write_file"].map((name) => ({ name, description: name, inputSchema: SCHEMA }));

function makeCtx(id: string, request: string, mode: TaskMode): TaskContext {
  let clock = 1_700_000_000_000;
  return create.context(
    { id, request, mode },
    { now: () => (clock += 1000), summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
  );
}

test("Invariante 1: solo finalize escribe el estado terminal y result en runTask; ante defecto inesperado, TaskManager.closeOnDefect cierra la tarea", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-inv1-"));
  try {
    const ctx = makeCtx("task_inv1", "Listar carpeta", "reactive");
    const runtime = new TaskRuntime();
    let seenFinish = 0;
    let seenResult = 0;
    let opsAfterFinish = 0;

    ctx.on("change", (ev) => {
      for (const op of ev.ops) {
        if (seenFinish > 0 && !(op.op === "set" && op.target === "result")) opsAfterFinish++;
        if (op.op === "finish") seenFinish++;
        if (op.op === "set" && op.target === "result") seenResult++;
      }
    });

    let pendingCalls = 0;
    const provider: IMCPServer = {
      name: "desktop_commander",
      version: "test",
      listTools: async () => FILE_TOOLS,
      callTool: async () => ({ content: [{ type: "text", text: "[FILE] ok.txt" }] }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n === "desktop_commander" ? provider : undefined),
        getDiscoveredTools: async (n) => (n === "desktop_commander" ? FILE_TOOLS : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: FILE_TOOLS[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0.95, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generateArgumentsFromView: async () => ({ args: { path: "C:\\Users\\Ana" }, rawInput: "", rawOutput: "", timing: TIMING }),
        generateQuestion: async () => ({ question: "?", rawInput: "", rawOutput: "" }),
        generatePendingFromView: async () => ({ pending: pendingCalls++ === 0 ? ["Listar"] : [], rawInput: "", rawOutput: "" }),
        generatePlanFromView: async () => { throw new Error("unused"); },
        generateFinalFromView: async () => ({ response: "Hecho.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
      autoMode: () => false,
    };

    await runTask(ctx, runtime, deps);
    assert.equal(seenFinish, 1);
    assert.equal(seenResult, 1);
    assert.equal(opsAfterFinish, 0);
    assert.equal(ctx.task.state, "completed");

    // Defecto interno dentro de runTask: `services.environment` lanza y `TaskManager.closeOnDefect` cierra la tarea.
    const services: EngineServices = {
      vault: createRefVault({ dir }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => { throw new Error("boom_environment"); },
      autoMode: () => false,
    };
    const tm = new TaskManager(
      { decision: deps.decision, discovery: deps.discovery, llm: deps.llm },
      () => ({ traceEnabled: false, tracePath: path.join(dir, "t.jsonl"), qwenModel: "q", decisionModel: "d", autoMode: false }) as JarvisConfig,
      services,
    );
    const started = tm.start("Dispara defecto", "reactive");
    await tm.drain(3000);
    const ended = tm.get(started.task.id)!;
    assert.equal(ended.task.state, "failed");
    assert.equal(ended.task.stopReason, "unrecoverable");
    assert.equal(ended.result?.origin, "fallback");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Invariante 4 y 5 (deliberativo): replan por step_failure preserva paso completed (sin repetirlo), marca failed como superseded y conserva effects()", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-inv45-"));
  try {
    const dispatched: { tool: string; args: Record<string, unknown> }[] = [];
    const finalViews: string[] = [];
    let planCalls = 0;
    let argCalls = 0;

    const provider: IMCPServer = {
      name: "desktop_commander",
      version: "test",
      listTools: async () => FILE_TOOLS,
      callTool: async (tool, args): Promise<MCPCallResult> => {
        dispatched.push({ tool, args });
        if (args.path === path.join(dir, "missing.txt")) {
          return { isError: true, content: [{ type: "text", text: "ENOENT: no such file" }] };
        }
        return { content: [{ type: "text", text: `OK:${tool}:${String(args.path)}` }] };
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    };

    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n === "desktop_commander" ? provider : undefined),
        getDiscoveredTools: async (n) => (n === "desktop_commander" ? FILE_TOOLS : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async (input) => {
          const want = input.step?.instruction.includes("Escribir") ? "write_file" : "read_file";
          return { action: "tool", tool: input.tools.find((t) => t.name === want) ?? input.tools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true };
        },
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async (input) => {
          const isErr = input.call.includes("ENOENT");
          return { answers: isErr ? { ok: 0.05, cumple: 0.05 } : { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" };
        },
        checkCompletion: async () => ({ requestComplete: 0.95, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generateArgumentsFromView: async (input) => {
          argCalls++;
          if (input.view.includes("Escribir primero")) return { args: { path: path.join(dir, "uno.txt"), content: "v1", mode: "rewrite" }, rawInput: "", rawOutput: "", timing: TIMING };
          if (input.view.includes("Leer ausente")) return { args: { path: path.join(dir, "missing.txt") }, rawInput: "", rawOutput: "", timing: TIMING };
          return { args: { path: path.join(dir, "dos.txt"), content: "v2", mode: "rewrite" }, rawInput: "", rawOutput: "", timing: TIMING };
        },
        generateQuestion: async () => ({ question: "?", rawInput: "", rawOutput: "" }),
        generatePendingFromView: async () => ({ pending: [], rawInput: "", rawOutput: "" }),
        generatePlanFromView: async () => {
          planCalls++;
          if (planCalls === 1) {
            return {
              steps: [
                { instruction: "Escribir primero", route: "files", expected: "uno.txt creado" },
                { instruction: "Leer ausente", route: "files", expected: "contenido leido" },
              ],
              rawInput: "",
              rawOutput: "",
            };
          }
          return {
            steps: [{ instruction: "Escribir reemplazo", route: "files", expected: "dos.txt creado" }],
            rawInput: "",
            rawOutput: "",
          };
        },
        generateFinalFromView: async (input) => {
          finalViews.push(input.view);
          return { response: "Completado tras replan.", rawInput: "", rawOutput: "" };
        },
      },
      vault: createRefVault({ dir }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "linux", home: dir }),
      autoMode: () => true,
    };

    const ctx = makeCtx("task_replan", "Crear dos archivos", "deliberative");
    const runtime = new TaskRuntime({
      onChange: (w) => {
        if (w?.kind === "plan") queueMicrotask(() => runtime.resolvePlanApproval(w.request.id, true));
      },
    });

    await runTask(ctx, runtime, deps);
    assert.equal(ctx.task.state, "completed");
    assert.equal(planCalls, 2);
    assert.ok(argCalls >= 3);

    const steps = ctx.find("steps", {});
    assert.equal(steps.length, 3);
    const [s1, s2, s3] = steps;
    assert.equal(s1.state, "completed");
    assert.equal(s1.superseded, false, "un paso completed nunca queda superseded");
    assert.equal(s2.state, "failed");
    assert.equal(s2.superseded, true, "el paso failed queda superseded tras el replan");
    assert.equal(s3.state, "completed");
    assert.equal(s3.superseded, false);

    // s1 ("uno.txt") se despachó UNA sola vez: el replan no lo repitió ni lo reemplazó.
    const unoCalls = dispatched.filter((d) => d.args.path === path.join(dir, "uno.txt"));
    assert.equal(unoCalls.length, 1);

    // Efectos de s1 sobreviven en ctx.effects() y llegan a la vista final.
    const effects = ctx.effects();
    assert.equal(effects.length, 2);
    assert.ok(effects.some((c) => c.stepId === s1.id));
    assert.ok(effects.some((c) => c.stepId === s3.id));
    assert.equal(finalViews.length, 1);
    assert.ok(finalViews[0].includes("uno.txt") && finalViews[0].includes("dos.txt"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Invariante 6 y 7: con Guard DENY (Regla B abs/rel y /etc/shadow), server.callTool NUNCA se invoca, incluso con autoMode y approvalTiers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-inv67-"));
  const refsDir = path.join(dir, "refs");
  fs.mkdirSync(refsDir, { recursive: true });
  try {
    let providerCalls = 0;
    const provider: IMCPServer = {
      name: "desktop_commander",
      version: "test",
      listTools: async () => FILE_TOOLS,
      callTool: async () => {
        providerCalls++;
        return { content: [{ type: "text", text: "NO DEBE EJECUTARSE" }] };
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    };

    const runScenario = async (toolName: string, proposedArgs: Record<string, unknown>) => {
      const ctx = makeCtx(`task_${toolName}`, "Probar guard", "reactive");
      const runtime = new TaskRuntime();
      let pendingCalls = 0;
      const deps: EngineDeps = {
        discovery: {
          getServer: (n) => (n === "desktop_commander" ? provider : undefined),
          getDiscoveredTools: async (n) => (n === "desktop_commander" ? FILE_TOOLS : []),
          getUnavailableServers: () => ({}),
          validateToolExists: async () => true,
        },
        decision: {
          chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
          chooseTool: async (input) => ({ action: "tool", tool: input.tools.find((t) => t.name === toolName) ?? input.tools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
          reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
          verifyResult: async () => ({ answers: { ok: 0.9, cumple: 0.9 }, rawInput: "", rawOutput: "" }),
          checkCompletion: async () => ({ requestComplete: 0.9, rawInput: "", rawOutput: "" }),
        },
        llm: {
          generateArgumentsFromView: async () => ({ args: proposedArgs, rawInput: "", rawOutput: "", timing: TIMING }),
          generateQuestion: async () => ({ question: "?", rawInput: "", rawOutput: "" }),
          generatePendingFromView: async () => ({ pending: pendingCalls++ === 0 ? ["Intentar"] : [], rawInput: "", rawOutput: "" }),
          generatePlanFromView: async () => { throw new Error("unused"); },
          generateFinalFromView: async () => ({ response: "Bloqueado.", rawInput: "", rawOutput: "" }),
        },
        vault: createRefVault({ dir: refsDir }),
        guardScope: { protectedDirs: [refsDir], relativeBases: [dir] },
        blacklist: EMPTY_BLACKLIST,
        environment: async () => ({ platform: "linux", home: dir }),
        autoMode: () => true,
        approvalTiers: () => true,
      };
      await runTask(ctx, runtime, deps);
      return ctx;
    };

    // 1. Regla B por ruta absoluta hacia refsDir
    const cAbs = await runScenario("write_file", { path: path.join(refsDir, "task_1", "r1.txt"), content: "x", mode: "rewrite" });
    assert.ok(cAbs.find("calls", { status: "tool_rejected" }).length >= 1);

    // 2. Regla B por ruta relativa contra relativeBases
    const cRel = await runScenario("write_file", { path: path.join("refs", "hack.txt"), content: "x", mode: "rewrite" });
    assert.ok(cRel.find("calls", { status: "tool_rejected" }).length >= 1);

    // 3. Patrón destructivo/sistema `/etc/shadow` en read_file
    const cShadow = await runScenario("read_file", { path: "/etc/shadow" });
    assert.ok(cShadow.find("calls", { status: "tool_rejected" }).length >= 1);

    assert.equal(providerCalls, 0, "el proveedor no debe ser invocado cuando Guard responde DENY");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Invariante 6 (orden): en runCall, Guard.evaluate se ejecuta estrictamente antes de server.callTool", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-inv6-order-"));
  const trace: string[] = [];
  const origEvaluate = Guard.evaluate.bind(Guard);
  Guard.evaluate = ((...args: Parameters<typeof Guard.evaluate>) => {
    trace.push(`guard:${args[1]}`);
    return origEvaluate(...args);
  }) as typeof Guard.evaluate;

  try {
    const provider: IMCPServer = {
      name: "desktop_commander",
      version: "test",
      listTools: async () => FILE_TOOLS,
      callTool: async (tool) => {
        trace.push(`dispatch:${tool}`);
        return { content: [{ type: "text", text: "[FILE] a.txt" }] };
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    };

    const ctx = makeCtx("task_order", "Listar", "reactive");
    const runtime = new TaskRuntime();
    let pendingCalls = 0;
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n === "desktop_commander" ? provider : undefined),
        getDiscoveredTools: async (n) => (n === "desktop_commander" ? FILE_TOOLS : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: FILE_TOOLS[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0.95, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generateArgumentsFromView: async () => ({ args: { path: dir }, rawInput: "", rawOutput: "", timing: TIMING }),
        generateQuestion: async () => ({ question: "?", rawInput: "", rawOutput: "" }),
        generatePendingFromView: async () => ({ pending: pendingCalls++ === 0 ? ["Listar"] : [], rawInput: "", rawOutput: "" }),
        generatePlanFromView: async () => { throw new Error("unused"); },
        generateFinalFromView: async () => ({ response: "Ok.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "linux", home: dir }),
      autoMode: () => false,
    };

    await runTask(ctx, runtime, deps);
    const gIdx = trace.indexOf("guard:list_directory");
    const dIdx = trace.indexOf("dispatch:list_directory");
    assert.ok(gIdx >= 0 && dIdx > gIdx, `orden esperado guard antes de dispatch, obtenido: ${JSON.stringify(trace)}`);
  } finally {
    Guard.evaluate = origEvaluate;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Invariante 6 y 7 (mcpRouter): /api/mcp/:server/call bloquea lecturas DENY (/etc/shadow) y mutaciones sin invocar server.callTool", async () => {
  let mcpCalls = 0;
  const discovery = {
    getServer: (name: string) =>
      name === "desktop_commander"
        ? {
            callTool: async () => {
              mcpCalls++;
              return { content: [], isError: false };
            },
            isConnected: () => true,
          }
        : undefined,
  } as unknown as DiscoveryEngine;

  const app = express();
  app.use(express.json());
  app.use("/api/mcp", createMcpRouter(discovery));
  const srv = http.createServer(app);
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address() as AddressInfo;

  try {
    const rShadow = await fetch(`http://127.0.0.1:${port}/api/mcp/desktop_commander/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "read_file", args: { path: "/etc/shadow" } }),
    });
    assert.equal(rShadow.status, 403);

    const rWrite = await fetch(`http://127.0.0.1:${port}/api/mcp/desktop_commander/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "write_file", args: { path: "/tmp/x.txt", content: "a", mode: "rewrite" } }),
    });
    assert.equal(rWrite.status, 403);
    assert.equal(mcpCalls, 0);
  } finally {
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
});

test("Invariante 8: refs estrictamente aisladas a la tarea activa (refs_unresolved en runCall y readRef en TaskManager)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-inv8-"));
  try {
    const vault = createRefVault({ dir: path.join(dir, "refs") });
    let dispatched = 0;
    const provider: IMCPServer = {
      name: "desktop_commander",
      version: "test",
      listTools: async () => FILE_TOOLS,
      callTool: async (_tool, args) => {
        dispatched++;
        if (typeof args.path === "string" && args.path.endsWith("big.txt")) {
          // Lo bastante largo para provocar truncado y guardar una ref en la tarea A.
          return { content: [{ type: "text", text: "Línea de contenido largo ".repeat(400) }] };
        }
        return { content: [{ type: "text", text: "ok" }] };
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    };

    const discovery: IDiscoveryEngine = {
      getServer: (n) => (n === "desktop_commander" ? provider : undefined),
      getDiscoveredTools: async (n) => (n === "desktop_commander" ? FILE_TOOLS : []),
      getUnavailableServers: () => ({}),
      validateToolExists: async () => true,
    };
    const decision: IActionDecision = {
      chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      chooseTool: async (input) => ({ action: "tool", tool: input.tools.find((t) => t.name === "read_file") ?? input.tools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
      verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
      checkCompletion: async () => ({ requestComplete: 0.95, rawInput: "", rawOutput: "" }),
    };

    let taskMode: "create_ref" | "foreign_ref" = "create_ref";
    let pendingCount = 0;
    const llm: EngineLLM = {
      generateArgumentsFromView: async () => ({
        args: { path: taskMode === "create_ref" ? path.join(dir, "big.txt") : "{{ref:r1}}" },
        rawInput: "",
        rawOutput: "",
        timing: TIMING,
      }),
      generateQuestion: async () => ({ question: "?", rawInput: "", rawOutput: "" }),
      generatePendingFromView: async () => ({ pending: pendingCount++ === 0 ? ["Leer"] : [], rawInput: "", rawOutput: "" }),
      generatePlanFromView: async () => { throw new Error("unused"); },
      generateFinalFromView: async () => ({ response: "Ok.", rawInput: "", rawOutput: "" }),
    };

    const tm = new TaskManager(
      { decision, discovery, llm },
      () => ({ traceEnabled: false, tracePath: path.join(dir, "t.jsonl"), qwenModel: "q", decisionModel: "d", autoMode: true }) as JarvisConfig,
      {
        vault,
        guardScope: { protectedDirs: [], relativeBases: [dir] },
        blacklist: EMPTY_BLACKLIST,
        environment: async () => ({ platform: "linux", home: dir }),
        autoMode: () => true,
      },
    );

    const dtoA = tm.start("Tarea A genera ref", "reactive");
    await tm.drain(5000);
    const snapA = tm.get(dtoA.task.id)!;
    assert.equal(snapA.refs.length, 1);
    assert.equal(snapA.refs[0].id, "r1");
    const refA = await tm.readRef(dtoA.task.id, "r1");
    assert.ok(typeof refA === "object" && refA !== null && "text" in refA);

    // Tarea B intenta usar `{{ref:r1}}` en sus argumentos (r1 existe solo en Tarea A) y leer r1 vía TaskManager.
    taskMode = "foreign_ref";
    pendingCount = 0;
    const dispatchedBeforeB = dispatched;
    const dtoB = tm.start("Tarea B usa ref ajena", "reactive");
    await tm.drain(5000);
    const snapB = tm.get(dtoB.task.id)!;
    assert.equal(dispatched, dispatchedBeforeB, "r1 ajena nunca debe llegar a server.callTool");
    assert.ok(snapB.calls.some((c) => c.status === "refs_unresolved"));
    assert.equal(await tm.readRef(dtoB.task.id, "r1"), "unknown_ref");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
