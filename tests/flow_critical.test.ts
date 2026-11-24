/**
 * Pruebas de rutas críticas del motor reactivo, `runCall`, `runStep`, `askUser`, `finalize` y recuperación no
 * cubiertas por `engine.test.ts`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import type { EngineDeps } from "../src/core/contracts.ts";
import { create } from "../src/core/ctx/index.ts";
import { possibleEffectsOf } from "../src/core/ctx/derive.ts";
import type { TaskContext } from "../src/core/ctx/index.ts";
import { FAKE_DISK } from "./fixtures.ts";
import { LLMServiceUnavailableError } from "../src/core/models/transport.ts";
import { runTask } from "../src/core/engine/runTask.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import type { IMCPServer } from "../src/core/mcp/types.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { createRefVault, RefVaultError } from "../src/core/refs/refVault.ts";
import { toolResult } from "../src/core/tools/result.ts";
import type { MCPCallResult, MCPTool } from "../src/core/types.ts";

const TIMING = { start: 0, end: 0, durationMs: 0 } as never;
const SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
    paths: { type: "array", items: { type: "string" } },
    isUrl: { type: "boolean" },
    content: { type: "string" },
    mode: { type: "string" },
    command: { type: "string" },
  },
};
const tool = (name: string): MCPTool => ({ name, description: name, inputSchema: SCHEMA });

/** Un `TaskRuntime` que aprueba toda confirmación pedida (los niveles de riesgo siempre están activos: rojo siempre pregunta al usuario). */
function approvingRuntime(): TaskRuntime {
  const runtime: TaskRuntime = new TaskRuntime({ onChange: (w) => w?.kind === "approval" && queueMicrotask(() => runtime.resolveApproval(w.request.id, true)) });
  return runtime;
}

function makeCtx(id: string, request: string) {
  let t = 1_700_000_000_000;
  return create.context(
    { id, request, mode: "reactive" },
    { now: () => (t += 100), summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
  );
}

test("reactivo: MAX_REOPENS = 2 detiene reaperturas infinitas provocadas por D5", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-reopen-"));
  try {
    let pendingCalls = 0;
    const ctx = makeCtx("task_reopen", "Crear carpeta y archivo");
    const fileTools = [tool("write_file")];
    const server: IMCPServer = {
      name: "jarvis_files_write",
      version: "t",
      listTools: async () => fileTools,
      callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n.startsWith("jarvis_files_") ? server : undefined),
        getDiscoveredTools: async (n) => (n.startsWith("jarvis_files_") ? fileTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files_write", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: fileTools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0.1, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => {
          pendingCalls++;
          // Cada confirmación devuelve un texto sin dígitos que sameItem considera similar al cumplido ("Crear carpeta trabajo ...").
          const variants = [
            "Crear carpeta trabajo",
            "Crear carpeta trabajo nueva",
            "Crear carpeta trabajo ahora",
            "Crear carpeta trabajo final",
          ];
          return { pending: [variants[(pendingCalls - 1) % variants.length]], rawInput: "", rawOutput: "" };
        },
        generateArgumentsFromView: async () => ({
          args: { path: `C:\\Users\\Ana\\a${pendingCalls}.txt`, content: "ok", mode: "rewrite" },
          rawInput: "",
          rawOutput: "",
          timing: TIMING,
        }),
        generatePlanFromView: async () => {
          throw new Error("no se usa");
        },
        generateQuestion: async () => ({ question: "¿?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "Completado.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, "refs") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
      autoMode: () => true,
      disk: FAKE_DISK,
    };
    await runTask(ctx, new TaskRuntime(), deps);
    // 1 inicial + 2 reaperturas (reopens < 2) + 1 consulta final ya con reopens=2 que no reabre → 4 llamadas a pending, 3 pasos
    assert.equal(pendingCalls, 4);
    assert.equal(ctx.find("steps", { state: "completed" }).length, 3);
    assert.equal(ctx.task.state, "completed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reactivo: un solo ítem cierra no_alternatives al 2.º fallo y respuestas largas de askUser guardan ref + fact atómico", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-esc-"));
  try {
    let askCount = 0;
    let pendingN = 0;
    const ctx = makeCtx("task_esc", "Falla dos veces y pregunta al usuario");
    const fileTools = [tool("write_file")];
    const server: IMCPServer = {
      name: "jarvis_files_write",
      version: "t",
      listTools: async () => fileTools,
      callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    let argN = 0;
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n.startsWith("jarvis_files_") ? server : undefined),
        getDiscoveredTools: async (n) => (n.startsWith("jarvis_files_") ? fileTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files_write", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: fileTools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        // info_missing dispara askUser en el primer paso; luego args_invalid hasta cerrar en el 2.º fallo del ítem
        reviewArgs: async () =>
          askCount === 0
            ? { review: "info_missing", probabilities: { info_missing: 0.9 } as Record<string, number>, rawInput: "", rawOutput: "" }
            : { review: "args_invalid", probabilities: { args_invalid: 0.9 } as Record<string, number>, rawInput: "", rawOutput: "" },
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => {
          pendingN++;
          return { pending: [pendingN === 1 ? "Escribir algo" : "Escribir algo con otra ruta"], rawInput: "", rawOutput: "" };
        },
        generateArgumentsFromView: async () => ({
          args: { path: `C:\\Users\\Ana\\x${argN++}.txt`, content: "hola", mode: "rewrite" },
          rawInput: "",
          rawOutput: "",
          timing: TIMING,
        }),
        generatePlanFromView: async () => {
          throw new Error("no se usa");
        },
        generateQuestion: async () => ({ question: "¿Qué escribo?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "No pude completarlo.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, "refs") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
      autoMode: () => true,
      disk: FAKE_DISK,
    };
    const rt = new TaskRuntime({
      onChange: (w) => {
        if (w?.kind === "question") {
          askCount++;
          // Respuesta larga (> BUDGET.factValueMax = 500) → genera ref y setFact juntos
          rt.answer("Z".repeat(700), w.question.id);
        }
      },
    });
    await runTask(ctx, rt, deps);
    assert.equal(ctx.task.stopReason, "no_alternatives");
    assert.equal(ctx.task.state, "failed");
    assert.equal(ctx.find("steps", { state: "failed" }).length, 2, "un ítem único pasa de 3 a 2 intentos");
    assert.ok(ctx.find("refs", {}).length >= 1, "la respuesta larga del usuario creó una ref");
    assert.ok(Object.keys(ctx.snapshot().facts).some((k) => k.startsWith("answer_s1_")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("callRunner: raceCancel registra interrupted ante cancelación en vuelo y descarta rechazo tardío; RefVaultError y context overflow cierran unrecoverable; isLlmDown salta LLM 3", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-race-"));
  try {
    // 1) raceCancel con rechazo tardío mientras se cancela
    const ctxCancel = makeCtx("task_race", "Cancelar lectura de C:\\Users\\Ana\\a.txt");
    const rtCancel = new TaskRuntime();
    let rejectLate!: (err: Error) => void;
    const slowServer: IMCPServer = {
      name: "jarvis_files_write",
      version: "t",
      listTools: async () => [tool("read_file")],
      callTool: () =>
        new Promise<MCPCallResult>((_resolve, reject) => {
          rejectLate = reject;
          setTimeout(() => rtCancel.cancel(), 10);
        }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const baseDeps = (srv: IMCPServer, vault: ReturnType<typeof createRefVault>, llm3Calls: number[]): EngineDeps => ({
      discovery: {
        getServer: (n) => (n.startsWith("jarvis_files_") ? srv : undefined),
        getDiscoveredTools: async (n) => (n.startsWith("jarvis_files_") ? [tool("read_file")] : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files_read", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: tool("read_file"), probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0.99, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => ({ pending: ["Leer"], rawInput: "", rawOutput: "" }),
        generateArgumentsFromView: async () => ({ args: { path: "C:\\Users\\Ana\\a.txt" }, rawInput: "", rawOutput: "", timing: TIMING }),
        generatePlanFromView: async () => {
          throw new Error("no");
        },
        generateQuestion: async () => ({ question: "¿?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => {
          llm3Calls.push(1);
          return { response: "Final LLM3", rawInput: "", rawOutput: "" };
        },
      },
      vault,
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
      autoMode: () => true,
      disk: FAKE_DISK,
    });

    const llm3a: number[] = [];
    await runTask(ctxCancel, rtCancel, baseDeps(slowServer, createRefVault({ dir: path.join(dir, "refs1") }), llm3a));
    // Rechazo tardío no debe provocar UnhandledRejection
    rejectLate(new Error("error tardío post-cancelación"));
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(ctxCancel.task.state, "cancelled");
    assert.equal(ctxCancel.find("calls", { status: "interrupted" }).length, 1);
    assert.equal(llm3a.length, 0, "cancelado usa fallback directo sin LLM 3");

    // 2) RefVaultError al guardar resultado truncado -> registra llamada sin ref + service_unavailable + unrecoverable + isLlmDown
    const bigServer: IMCPServer = {
      name: "jarvis_files_write",
      version: "t",
      listTools: async () => [tool("read_file")],
      callTool: async () => ({ content: [{ type: "text", text: "L".repeat(BUDGET.summaryMax + 1000) }] }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const brokenVault = {
      put: async () => {
        throw new RefVaultError("write_failed", "disco lleno simulado");
      },
      get: async () => null,
      deleteTask: async () => undefined,
    };
    const ctxVault = makeCtx("task_vault_fail", "Leer archivo muy largo C:\\Users\\Ana\\a.txt");
    await runTask(ctxVault, new TaskRuntime(), baseDeps(bigServer, brokenVault as never, []));
    assert.equal(ctxVault.task.stopReason, "unrecoverable");
    assert.equal(ctxVault.find("calls", { status: "ok" }).length, 1);
    assert.equal(ctxVault.find("calls", { status: "ok" })[0].ref, null);
    assert.equal(ctxVault.find("errors", { kind: "service_unavailable" }).length, 1);

    // 3) isLlmDown: falla LLM en generatePending → finalize salta LLM 3 (llm3Calls queda en 0)
    const llm3Down: number[] = [];
    const ctxLlmDown = makeCtx("task_llm_down", "LLM caído");
    const baseDown = baseDeps(bigServer, createRefVault({ dir: path.join(dir, "refs2") }), llm3Down);
    const downDeps: EngineDeps = {
      ...baseDown,
      llm: {
        ...baseDown.llm,
        generatePendingFromView: async () => {
          throw new LLMServiceUnavailableError("Ollama apagado");
        },
      },
      modelUnavailablePauseMaxMs: () => 0,
    };
    await runTask(ctxLlmDown, new TaskRuntime(), downDeps);
    assert.equal(ctxLlmDown.task.stopReason, "unrecoverable");
    assert.equal(ctxLlmDown.result?.origin, "fallback");
    assert.equal(llm3Down.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("RC-21 + maxCallsPerStep: rerun bloqueado hasta escritura intermedia", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-rc21-"));
  try {
    const dispatched: string[] = [];
    const fileTools = [tool("write_file")];
    const termTools = [tool("run_command")];
    const srv = (name: string, tools: MCPTool[]): IMCPServer => ({
      name,
      version: "t",
      listTools: async () => tools,
      callTool: async (t) => {
        dispatched.push(t);
        return { content: [{ type: "text", text: "ok" }] };
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    });
    const ctx = makeCtx("task_rc21", "Correr pruebas, escribir cambio, volver a correr pruebas");
    let stepNum = 0;
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n.startsWith("jarvis_files_") ? srv(n, fileTools) : n === "jarvis_terminal" ? srv(n, termTools) : undefined),
        getDiscoveredTools: async (n) => (n.startsWith("jarvis_files_") ? fileTools : n === "jarvis_terminal" ? termTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async (inp) => ({
          action: "route",
          route: stepNum === 1 ? "files_write" : inp.routes.includes("terminal") ? "terminal" : inp.routes[0],
          probabilities: {},
          rawInput: "",
          rawOutput: "",
          shortcut: true,
        }),
        chooseTool: async (inp) => ({ action: "tool", tool: inp.tools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0.99, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => {
          stepNum = 0;
          return {
            pending: ["Correr pruebas npm test", "Escribir cambio en nota.txt", "Correr pruebas npm test otra vez"],
            rawInput: "",
            rawOutput: "",
          };
        },
        generateArgumentsFromView: async (inp) => {
          if (inp.tool.name === "write_file") {
            stepNum = 2;
            return { args: { path: "C:\\Users\\Ana\\nota.txt", content: "cambio", mode: "rewrite" }, rawInput: "", rawOutput: "", timing: TIMING };
          }
          stepNum++;
          return { args: { command: "npm test" }, rawInput: "", rawOutput: "", timing: TIMING };
        },
        generatePlanFromView: async () => {
          throw new Error("no");
        },
        generateQuestion: async () => ({ question: "¿Algún detalle más?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "Hecho.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, "refs") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
      autoMode: () => true,
      disk: FAKE_DISK,
    };
    await runTask(ctx, approvingRuntime(), deps);
    assert.deepEqual(dispatched, ["run_command", "write_file", "run_command"]);
    assert.equal(ctx.task.state, "completed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stepLoop: maxCallsPerStep pregunta al usuario antes de fallar (askFirst) y routeExhausted descarta ruta agotada o hace fallback si todas se agotan", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-limits-"));
  try {
    // 1) Ruta files se agota tras maxNotAccomplishedPerRoute=2 rechazos not_accomplished y pasa a ofrecer only terminal; si solo hay files y se agota, hace fallback y luego pregunta al llegar a maxCallsPerStep=6.
    const seenRoutes: string[][] = [];
    let askTriggered = 0;
    let callN = 0;
    const fileTools = [tool("list_folder")];
    const termTools = [tool("run_command")];
    const srv = (name: string, tools: MCPTool[]): IMCPServer => ({
      name,
      version: "t",
      listTools: async () => tools,
      callTool: async (t) => ({ content: [{ type: "text", text: `${t} ok ${callN}` }] }),
      isConnected: () => true,
      reconnect: async () => undefined,
    });
    const ctx = makeCtx("task_exhaust", "Listar archivos de C:\\Users\\Ana");
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n.startsWith("jarvis_files_") ? srv(n, fileTools) : n === "jarvis_terminal" ? srv(n, termTools) : undefined),
        getDiscoveredTools: async (n) => (n.startsWith("jarvis_files_") ? fileTools : n === "jarvis_terminal" ? termTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async (inp) => {
          seenRoutes.push([...inp.routes]);
          return { action: "route", route: inp.routes[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true };
        },
        chooseTool: async (inp) => ({ action: "tool", tool: inp.tools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        // ok=0.95 cumple=0.1 -> not_accomplished
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.1 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => ({ pending: ["Obtener listado"], rawInput: "", rawOutput: "" }),
        generateArgumentsFromView: async (inp) => {
          const i = callN++;
          return inp.tool.name === "run_command"
            ? { args: { command: `dir C:\\Users\\Ana\\sub${i}` }, rawInput: "", rawOutput: "", timing: TIMING }
            : { args: { path: i === 0 ? "C:\\Users\\Ana" : `C:\\Users\\Ana` + (i % 2 === 0 ? "" : "") }, rawInput: "", rawOutput: "", timing: TIMING };
        },
        generatePlanFromView: async () => {
          throw new Error("no");
        },
        generateQuestion: async () => ({ question: "¿Qué carpeta querés exactamente?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "No alcanzó.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, "refs") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
      autoMode: () => true,
      disk: FAKE_DISK,
    };

    // Fuerza maxVerifyRejectionsPerStep=2 por paso; como ambas rutas fallan en el mismo paso (files x2 -> routeExhausted -> terminal), verifica transición files -> terminal
    await runTask(ctx, new TaskRuntime(), deps);
    assert.ok(seenRoutes.some((r) => r.includes("files_read") && r.includes("terminal")));

    // 2) maxCallsPerStep (6) con askFirst=true: 6 llamadas waiting_input ejecutan sin contar como rejected -> runStep pregunta al usuario y luego falla con call_cap
    const ctxCap = create.context(
      { id: "task_call_cap", request: "Ejecutar proceso interactivo", mode: "deliberative" },
      { now: () => 1_700_000_000_000, summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
    );
    const pCap = ctxCap.apply({ op: "add", target: "plans", value: { trigger: "initial", feedback: null, stepId: null } }).ids[0];
    const sCap = ctxCap.apply({ op: "add", target: "steps", value: { planId: pCap, instruction: "Instalar", route: "terminal", expected: "ok" } }).ids[0];
    for (let k = 0; k < BUDGET.maxCallsPerStep; k++) {
      ctxCap.apply({
        op: "add",
        target: "calls",
        value: {
          stepId: sCap,
          route: "terminal",
          tool: "start_process",
          kind: "write",
          args: { command: `step_${k}` },
          sig: `sig_${k}`,
          status: "waiting_input",
          summary: "waiting",
          ref: null,
        },
      });
    }
    const { runStep } = await import("../src/core/engine/stepLoop.ts");
    const { createEngineEnv } = await import("../src/core/engine/env.ts");
    const rtCap = new TaskRuntime({
      onChange: (w) => {
        if (w?.kind === "question") rtCap.answer("continuar con opción A", w.question.id);
      },
    });
    const capDeps: EngineDeps = {
      ...deps,
      llm: {
        ...deps.llm,
        generateQuestion: async () => {
          askTriggered++;
          return { question: "¿Qué opción elijo?", rawInput: "", rawOutput: "" };
        },
      },
    };
    const capOutcome = await runStep(createEngineEnv(ctxCap, rtCap, capDeps), { kind: "planned", stepId: sCap });
    assert.deepEqual(capOutcome, { kind: "failed", cause: "call_cap" });
    assert.equal(askTriggered, 1);
    assert.equal(ctxCap.snapshot().facts[`answer_${sCap}_1`]?.value, "¿Qué opción elijo? -> continuar con opción A");

    // 3) finalize con forFinal desbordado (ContextOverflowError -> fallback sin llamar a LLM 3).
    let llm3Called = 0;
    let writeN = 0;
    const bigSrv: IMCPServer = {
      name: "jarvis_files_write",
      version: "t",
      listTools: async () => [tool("write_file")],
      callTool: async () => ({ content: [{ type: "text", text: "W".repeat(2400) }] }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const ctxFinOver = makeCtx("task_fin_overflow", "Crear 9 archivos grandes");
    const items = Array.from({ length: 9 }, (_, i) => `Crear archivo número_${i}`);
    const depsFinOver: EngineDeps = {
      discovery: {
        getServer: (n) => (n.startsWith("jarvis_files_") ? bigSrv : undefined),
        getDiscoveredTools: async (n) => (n.startsWith("jarvis_files_") ? [tool("write_file")] : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files_write", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: tool("write_file"), probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0.99, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => ({ pending: items, rawInput: "", rawOutput: "" }),
        generateArgumentsFromView: async () => ({
          args: { path: `C:\\Users\\Ana\\over_${writeN++}.txt`, content: "ok", mode: "rewrite" },
          rawInput: "",
          rawOutput: "",
          timing: TIMING,
        }),
        generatePlanFromView: async () => {
          throw new Error("no");
        },
        generateQuestion: async () => ({ question: "¿Sigo?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => {
          llm3Called++;
          return { response: "No debería llamarse", rawInput: "", rawOutput: "" };
        },
      },
      vault: createRefVault({ dir: path.join(dir, "refs2") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
      autoMode: () => true,
      disk: FAKE_DISK,
    };
    await runTask(ctxFinOver, new TaskRuntime(), depsFinOver);
    assert.equal(ctxFinOver.task.state, "completed");
    assert.equal(ctxFinOver.result?.origin, "fallback");
    assert.equal(llm3Called, 0, "si forFinal desborda la reserva, finalize usa fallback directo sin LLM 3");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reactivo: si pending tras un fallo devuelve solo un ítem ya cumplido, no cierra completed (cierra partial no_alternatives)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-empty-fail-"));
  try {
    let pendingCall = 0;
    const ctx = makeCtx("task_empty_after_fail", "Escribir primero y luego leer imposible");
    const fileTools = ["edit_file", "write_file"].map(tool);
    const server: IMCPServer = {
      name: "jarvis_files_write",
      version: "t",
      listTools: async () => fileTools,
      callTool: async (t) => ({ content: [{ type: "text", text: t === "write_file" ? "ok" : "error" }], ...(t === "edit_file" ? { isError: true } : {}) }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n.startsWith("jarvis_files_") ? server : undefined),
        getDiscoveredTools: async (n) => (n.startsWith("jarvis_files_") ? fileTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files_write", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async (inp) => ({
          action: "tool",
          tool: inp.tools.find((t) => t.name === (inp.step?.instruction?.includes("Escribir") ? "write_file" : "edit_file"))!,
          probabilities: {},
          rawInput: "",
          rawOutput: "",
          shortcut: true,
        }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0.99, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => {
          pendingCall++;
          if (pendingCall === 1) return { pending: ["Escribir primero", "Leer imposible"], rawInput: "", rawOutput: "" };
          // Tras fallar "Leer imposible", el modelo devuelve únicamente el ítem ya cumplido "Escribir primero".
          return { pending: ["Escribir primero"], rawInput: "", rawOutput: "" };
        },
        generateArgumentsFromView: async (inp) =>
          inp.tool.name === "write_file"
            ? { args: { path: "C:\\Users\\Ana\\primero.txt", content: "ok", mode: "rewrite" }, rawInput: "", rawOutput: "", timing: TIMING }
            : { args: { path: "C:\\Users\\Ana\\imposible.txt" }, rawInput: "", rawOutput: "", timing: TIMING },
        generatePlanFromView: async () => {
          throw new Error("no se usa");
        },
        generateQuestion: async () => ({ question: "¿?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "Parcial.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, "refs") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
      autoMode: () => true,
      disk: FAKE_DISK,
    };
    await runTask(ctx, new TaskRuntime(), deps);
    assert.equal(ctx.task.stopReason, "no_alternatives");
    assert.equal(ctx.task.state, "partial");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Ocho ítems que fallan una vez cada uno. Con `recovers` el modelo de pendientes reescribe cada ítem fallido en uno que sale bien (el progreso reinicia la racha);
 * sin él, reescribe cada uno en otro texto que también falla (la racha crece hasta el tope).
 */
async function escalationScenario(recovers: boolean): Promise<TaskContext> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-esc6-"));
  try {
    const fileTools = [tool("read_file")];
    let stepIdx = 0;
    const server: IMCPServer = {
      name: "jarvis_files_write",
      version: "t",
      listTools: async () => fileTools,
      callTool: async (_t, a) => {
        const fail = String(a.path).includes("fail_");
        return { content: [{ type: "text", text: fail ? "error" : "ok" }], ...(fail ? { isError: true } : {}) };
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const items = Array.from({ length: 8 }, (_, i) => `Leer C:\\Users\\Ana\\fail_${i}.txt`);
    let pendingN = 0;
    const ctx = makeCtx(recovers ? "task_esc_recovers" : "task_esc_streak", "Ocho pasos donde cada ítem falla una vez y se reescribe");
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n.startsWith("jarvis_files_") ? server : undefined),
        getDiscoveredTools: async (n) => (n.startsWith("jarvis_files_") ? fileTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async (inp) => ({ action: "route", route: (inp.step?.instruction ?? "").includes("segundo") ? "files_write" : "files_read", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: fileTools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0.99, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => {
          pendingN++;
          if (pendingN === 1) return { pending: items, rawInput: "", rawOutput: "" };
          return { pending: [recovers ? `Leer C:\\Users\\Ana\\ok_${stepIdx++}.txt` : `Leer C:\\Users\\Ana\\fail_${100 + stepIdx++}.txt`], rawInput: "", rawOutput: "" };
        },
        generateArgumentsFromView: async () => {
          const instr = ctx.current().step?.instruction ?? "";
          const match = instr.match(/C:\\Users\\Ana\\(?:fail|ok)_\d+\.txt/);
          return {
            args: { path: match ? match[0] : "C:\\Users\\Ana\\fail_0.txt" },
            rawInput: "",
            rawOutput: "",
            timing: TIMING,
          };
        },
        generatePlanFromView: async () => {
          throw new Error("no se usa");
        },
        generateQuestion: async () => ({ question: "¿?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "Parcial.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, "refs") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
      autoMode: () => true,
      disk: FAKE_DISK,
    };
    await runTask(ctx, new TaskRuntime(), deps);
    return ctx;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("reactivo: los fallos NO se acumulan entre ítems que se recuperan: 8 pasos fallidos en total (uno por ítem) y la tarea termina completed", async () => {
  const ctx = await escalationScenario(true);
  assert.equal(ctx.task.state, "completed");
  assert.equal(ctx.task.stopReason, null);
  assert.equal(ctx.find("steps", { state: "failed" }).length, 8, "ocho fallos sueltos, más que maxEscalations = 6, y no cierran la tarea");
  assert.equal(ctx.consecutiveFailures(), 0, "cada ítem reescrito terminó bien y reinició la racha");
});

test("reactivo: una racha de pasos fallidos SEGUIDOS corta recién al 7.º (maxEscalations = 6), aunque cada reescritura sea un texto distinto", async () => {
  const ctx = await escalationScenario(false);
  assert.equal(BUDGET.maxEscalations, 6);
  assert.equal(ctx.task.stopReason, "no_alternatives");
  assert.equal(ctx.task.state, "failed", "sin efectos ni llamadas aprobadas");
  assert.equal(ctx.find("steps", { state: "failed" }).length, 7, "permite hasta 6 fallos seguidos y corta al 7.º");
  assert.equal(ctx.consecutiveFailures(), 7);
});


test("verificación: una web_search `found` no se le pregunta al modelo de decisión (el juez del buscador ya respondió la consulta)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-webfound-"));
  try {
    let verifyCalls = 0;
    let pendingN = 0;
    const ctx = makeCtx("task_webfound", "Busca opciones de hospedaje en Mendoza");
    const webTools = [{ name: "web_search", description: "web_search", inputSchema: { type: "object", properties: { need: { type: "string" } } } } as MCPTool];
    const server: IMCPServer = {
      name: "jarvis_web",
      version: "t",
      listTools: async () => webTools,
      callTool: async () => ({ content: [{ type: "text", text: "status: found · 3 passages from 3 sources\n[1] Hoteles en Mendoza desde $18.565" }] }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n === "jarvis_web" ? server : undefined),
        getDiscoveredTools: async (n) => (n === "jarvis_web" ? webTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "web", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: webTools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        // Si se la consultara, rechazaría (cumple 0,1): el paso solo completa si el código resolvió la verificación.
        verifyResult: async () => {
          verifyCalls++;
          return { answers: { ok: 0.9, cumple: 0.1 }, rawInput: "", rawOutput: "" };
        },
        checkCompletion: async () => ({ requestComplete: 1, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => ({ pending: ++pendingN === 1 ? ["Buscar opciones de hospedaje en Mendoza"] : [], rawInput: "", rawOutput: "" }),
        generateArgumentsFromView: async () => ({ args: { need: "Opciones de hospedaje en Mendoza, Argentina" }, rawInput: "", rawOutput: "", timing: TIMING }),
        generatePlanFromView: async () => {
          throw new Error("no se usa");
        },
        generateQuestion: async () => ({ question: "¿?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "Listo.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, "refs") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:\Users\Ana" }),
      autoMode: () => true,
      disk: FAKE_DISK,
    };
    await runTask(ctx, new TaskRuntime(), deps);
    assert.equal(verifyCalls, 0, "la verificación por código resolvió ok y cumple");
    assert.equal(ctx.find("calls", {})[0]?.verdict, "approved");
    assert.equal(ctx.task.state, "completed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("alias con subruta: `desktop/Archivos/Documentos` se expande a la ruta real antes del Guard y se ejecuta (antes el Guard lo negaba como ruta del proyecto)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-aliasflow-"));
  try {
    let pendingN = 0;
    const received: Array<Record<string, unknown>> = [];
    const ctx = makeCtx("task_aliasflow", "Crea la carpeta Archivos/Documentos en el escritorio");
    const fileTools = [tool("create_folder")];
    const server: IMCPServer = {
      name: "jarvis_files_write",
      version: "t",
      listTools: async () => fileTools,
      callTool: async (_name, args) => {
        received.push(args);
        return { content: [{ type: "text", text: "status: ok · created folder" }] };
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n.startsWith("jarvis_files_") ? server : undefined),
        getDiscoveredTools: async (n) => (n.startsWith("jarvis_files_") ? fileTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files_write", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: fileTools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 1, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => ({ pending: ++pendingN === 1 ? ["Crear la carpeta Archivos/Documentos en el escritorio"] : [], rawInput: "", rawOutput: "" }),
        generateArgumentsFromView: async () => ({ args: { path: "desktop/Archivos/Documentos" }, rawInput: "", rawOutput: "", timing: TIMING }),
        generatePlanFromView: async () => {
          throw new Error("no se usa");
        },
        generateQuestion: async () => ({ question: "¿?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "Listo.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, "refs") }),
      // El proyecto es protegido y las rutas relativas se resuelven contra él: sin expandir el alias, `desktop/...` caía acá.
      guardScope: { protectedDirs: [process.cwd()], relativeBases: [process.cwd()] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:/Users/Ana", desktop: "C:/Users/Ana/Desktop" }),
      autoMode: () => true,
      disk: FAKE_DISK,
    };
    await runTask(ctx, new TaskRuntime(), deps);
    assert.equal(received.length, 1, "la herramienta recibió la llamada");
    assert.equal(String(received[0].path).replaceAll("\\", "/"), "C:/Users/Ana/Desktop/Archivos/Documentos", "con la ruta real, no con el alias");
    assert.equal(ctx.find("calls", {})[0]?.status, "ok");
    assert.equal(ctx.task.state, "completed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("una escritura que no halló la carpeta (`not_found`) se rechaza sin consultar al modelo de verificación y no cuenta como posible cambio", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-wnf-"));
  try {
    let verifyCalls = 0;
    let argN = 0;
    const ctx = makeCtx("task_wnf", "Crea la carpeta Informes/2026 en mis documentos");
    const writeTools = [tool("create_folder")];
    const server: IMCPServer = {
      name: "jarvis_files_write",
      version: "t",
      listTools: async () => writeTools,
      callTool: async () =>
        toolResult({
          text: "Parent folder does not exist: 'C:/Users/Ana/Documents/Informes'.",
          raw: "Parent folder does not exist: 'C:/Users/Ana/Documents/Informes'.",
          data: { state: "error", reason: "not_found" },
          isError: true,
        }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n.startsWith("jarvis_files_") ? server : undefined),
        getDiscoveredTools: async (n) => (n.startsWith("jarvis_files_") ? writeTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files_write", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: writeTools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => {
          verifyCalls++;
          return { answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" };
        },
        checkCompletion: async () => ({ requestComplete: 0, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => ({ pending: ["Crear la carpeta Informes/2026"], rawInput: "", rawOutput: "" }),
        generateArgumentsFromView: async () => ({ args: { path: `C:/Users/Ana/Documents/Informes/${argN++}` }, rawInput: "", rawOutput: "", timing: TIMING }),
        generatePlanFromView: async () => {
          throw new Error("no se usa");
        },
        generateQuestion: async () => ({ question: "¿?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "No pude.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, "refs") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "windows", home: "C:/Users/Ana", documents: "C:/Users/Ana/Documents" }),
      autoMode: () => true,
      disk: FAKE_DISK,
    };
    await runTask(ctx, new TaskRuntime(), deps);
    const calls = ctx.find("calls", {});
    assert.ok(calls.length > 0);
    assert.equal(calls[0].status, "not_found");
    assert.equal(calls[0].verdict, "rejected");
    assert.equal(calls[0].reason, "no_usable_data");
    assert.equal(verifyCalls, 0, "el rechazo es determinista: el modelo no se consulta");
    assert.equal(possibleEffectsOf(calls).length, 0, "no se escribió nada: no es un posible cambio");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
