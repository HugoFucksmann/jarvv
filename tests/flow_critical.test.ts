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
import { LLMServiceUnavailableError } from "../src/core/models/transport.ts";
import { runTask } from "../src/core/engine/runTask.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import type { IMCPServer } from "../src/core/mcp/types.ts";
import { compileBlacklist, EMPTY_BLACKLIST, type Blacklist } from "../src/core/policy/blacklist.ts";
import { createRefVault, RefVaultError } from "../src/core/refs/refVault.ts";
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

function makeCtx(id: string, request: string) {
  let t = 1_700_000_000_000;
  return create.context(
    { id, request, mode: "reactive" },
    { now: () => (t += 100), summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
  );
}

test("reactivo: abandona un ítem tras agotar sus fallos si quedan otros ítems y cierra partial (no_alternatives)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-crit-"));
  try {
    let pendingCall = 0;
    let argCall = 0;
    const ctx = makeCtx("task_abandon", "Primero fallido, segundo bien");
    const fileTools = ["read_file", "write_file"].map(tool);
    const server: IMCPServer = {
      name: "desktop_commander",
      version: "t",
      listTools: async () => fileTools,
      callTool: async (t) => ({ content: [{ type: "text", text: t === "write_file" ? "ok" : "error" }], ...(t === "read_file" ? { isError: true } : {}) }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n === "desktop_commander" ? server : undefined),
        getDiscoveredTools: async (n) => (n === "desktop_commander" ? fileTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async (inp) => ({
          action: "tool",
          tool: inp.tools.find((t) => t.name === (inp.step?.instruction?.includes("segundo") ? "write_file" : "read_file"))!,
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
          if (pendingCall === 1) return { pending: ["Leer primero imposible", "Escribir segundo archivo"], rawInput: "", rawOutput: "" };
          return { pending: ["Leer primero imposible v2"], rawInput: "", rawOutput: "" };
        },
        generateArgumentsFromView: async (inp) => {
          const i = argCall++;
          if (inp.tool.name === "write_file") return { args: { path: "C:\\Users\\Ana\\bien.txt", content: "ok", mode: "rewrite" }, rawInput: "", rawOutput: "", timing: TIMING };
          return { args: { path: `C:\\Users\\Ana\\malo_${i}.txt` }, rawInput: "", rawOutput: "", timing: TIMING };
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
      approvalTiers: () => false,
    };
    const rt = new TaskRuntime();
    await runTask(ctx, rt, deps);
    assert.equal(ctx.task.stopReason, "no_alternatives");
    assert.equal(ctx.task.state, "partial");
    assert.ok(ctx.find("calls", { tool: "write_file", verdict: "approved" }).length === 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reactivo: MAX_REOPENS = 2 detiene reaperturas infinitas provocadas por D5", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-reopen-"));
  try {
    let pendingCalls = 0;
    const ctx = makeCtx("task_reopen", "Crear carpeta y archivo");
    const fileTools = [tool("write_file")];
    const server: IMCPServer = {
      name: "desktop_commander",
      version: "t",
      listTools: async () => fileTools,
      callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n === "desktop_commander" ? server : undefined),
        getDiscoveredTools: async (n) => (n === "desktop_commander" ? fileTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
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
      approvalTiers: () => false,
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

test("reactivo: tercera escalación (escalationsExceeded) cierra no_alternatives y respuestas largas de askUser guardan ref + fact atómico", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-esc-"));
  try {
    let askCount = 0;
    const ctx = makeCtx("task_esc", "Falla tres veces y pregunta al usuario");
    const fileTools = [tool("write_file")];
    const server: IMCPServer = {
      name: "desktop_commander",
      version: "t",
      listTools: async () => fileTools,
      callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    let argN = 0;
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n === "desktop_commander" ? server : undefined),
        getDiscoveredTools: async (n) => (n === "desktop_commander" ? fileTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: fileTools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        // info_missing dispara askUser en el primer paso; luego args_invalid hasta escalar
        reviewArgs: async () =>
          askCount === 0
            ? { review: "info_missing", probabilities: { info_missing: 0.9 } as Record<string, number>, rawInput: "", rawOutput: "" }
            : { review: "args_invalid", probabilities: { args_invalid: 0.9 } as Record<string, number>, rawInput: "", rawOutput: "" },
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => ({ pending: ["Escribir algo"], rawInput: "", rawOutput: "" }),
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
      approvalTiers: () => false,
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
    assert.equal(ctx.find("steps", { state: "failed" }).length, 3);
    assert.ok(ctx.find("refs", {}).length >= 1, "la respuesta larga del usuario creó una ref");
    assert.ok(Object.keys(ctx.snapshot().facts).some((k) => k.startsWith("answer_s1_")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("callRunner: allowedDirectories revisa args.paths[] y omite isUrl en read_file; lista negra en vivo y umbral estricto de sensitive", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-paths-"));
  const allowed = path.join(dir, "permitido");
  fs.mkdirSync(allowed, { recursive: true });
  try {
    const dispatched: { tool: string; args: Record<string, unknown> }[] = [];
    const tools = ["read_file", "run_command"].map(tool);
    const server = (name: string): IMCPServer => ({
      name,
      version: "t",
      listTools: async () => tools,
      callTool: async (t, a) => {
        dispatched.push({ tool: t, args: a });
        return { content: [{ type: "text", text: "contenido ok" }] };
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    });
    let stepArgsIdx = 0;
    let activeBlacklist: Blacklist = compileBlacklist([{ tool: "run_command", pattern: "Invoke-WebRequest", level: "blocked", reason: "No descargar" }]);

    const ctx = makeCtx("task_live_bl", "Leer https://api.acme-corp.invalid/data.json y luego ejecutar comando sensible");
    const deps: EngineDeps = {
      discovery: {
        getServer: (n) => (n === "desktop_commander" || n === "jarvis_terminal" ? server(n) : undefined),
        getDiscoveredTools: async () => tools,
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async (inp) => ({
          action: "route",
          route: stepArgsIdx >= 2 && inp.routes.includes("terminal") ? "terminal" : "files",
          probabilities: {},
          rawInput: "",
          rawOutput: "",
          shortcut: true,
        }),
        chooseTool: async (inp) => ({
          action: "tool",
          tool: inp.tools.find((t) => t.name === (inp.route === "terminal" ? "run_command" : "read_file"))!,
          probabilities: {},
          rawInput: "",
          rawOutput: "",
          shortcut: true,
        }),
        // Para sensitive (run_command), approved=0.62 pasa umbral normal (0.6) pero NO estricto (BUDGET.sensitiveApprove = 0.65) → tool_rejected
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 0.62, args_invalid: 0.38 }, rawInput: "", rawOutput: "" }),
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0.99, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => ({ pending: ["Leer archivos y correr comando"], rawInput: "", rawOutput: "" }),
        generateArgumentsFromView: async () => {
          const i = stepArgsIdx++;
          // 0: paths[] fuera de allowedDirectories → tool_rejected
          if (i === 0) return { args: { paths: [path.join(dir, "fuera", "x.txt")] }, rawInput: "", rawOutput: "", timing: TIMING };
          // 1: read_file con isUrl=true → saltea allowedDirectories y ejecuta!
          if (i === 1) return { args: { path: "https://api.acme-corp.invalid/data.json", isUrl: true }, rawInput: "", rawOutput: "", timing: TIMING };
          return { args: { command: "Write-Output ok" }, rawInput: "", rawOutput: "", timing: TIMING };
        },
        generatePlanFromView: async () => {
          throw new Error("no se usa");
        },
        generateQuestion: async () => ({ question: "¿?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "Listo.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, "refs") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: () => activeBlacklist,
      allowedDirectories: () => [allowed],
      analyzeCommand: async () => ({ detectedPaths: [], unresolvablePaths: [], syntaxErrors: [], commands: [] }),
      environment: async () => ({ platform: "windows", home: allowed }),
      autoMode: () => true,
      approvalTiers: () => false,
    };
    await runTask(ctx, new TaskRuntime(), deps);
    const rejected = ctx.find("calls", { status: "tool_rejected" });
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].summary ?? "", /fuera de allowedDirectories/);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].args.isUrl, true);
    assert.equal(ctx.task.state, "completed");

    // Cambia lista negra en vivo y verifica nivel blocked + sensitive strict
    activeBlacklist = compileBlacklist([
      { tool: "run_command", pattern: "blockedcmd", level: "blocked", reason: "Prohibido en vivo" },
      { tool: "run_command", pattern: "senscmd", level: "sensitive", reason: "Requiere confianza alta" },
    ]);
    const ctx2 = makeCtx("task_live_bl2", "Probar lista negra nivel blocked y sensitive");
    let seq = 0;
    const deps2: EngineDeps = {
      ...deps,
      decision: {
        ...deps.decision,
        chooseRoute: async () => ({ action: "route", route: "terminal", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: tools[1], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      },
      llm: {
        ...deps.llm,
        generatePendingFromView: async () => ({ pending: ["Probar comandos"], rawInput: "", rawOutput: "" }),
        generateArgumentsFromView: async () => {
          const n = seq++;
          if (n === 0) return { args: { command: "Set-Content blockedcmd ok" }, rawInput: "", rawOutput: "", timing: TIMING };
          if (n === 1) return { args: { command: "Set-Content senscmd ok" }, rawInput: "", rawOutput: "", timing: TIMING };
          return { args: { command: "Get-Date" }, rawInput: "", rawOutput: "", timing: TIMING };
        },
      },
    };
    await runTask(ctx2, new TaskRuntime(), deps2);
    const rej2 = ctx2.find("calls", { status: "tool_rejected" });
    assert.equal(rej2.length, 2);
    assert.match(rej2[0].summary ?? "", /Prohibido en vivo/);
    assert.match(rej2[1].summary ?? "", /not confident enough to run it automatically/);
    assert.equal(ctx2.task.state, "completed");
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
      name: "desktop_commander",
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
        getServer: (n) => (n === "desktop_commander" ? srv : undefined),
        getDiscoveredTools: async (n) => (n === "desktop_commander" ? [tool("read_file")] : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
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
      approvalTiers: () => false,
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
      name: "desktop_commander",
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

test("finalize: compone statusNote + stripNoChangesFiller + placeNote en tarea partial con wrong_place", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-fin-"));
  const wrongDir = path.join(dir, "otra");
  fs.mkdirSync(wrongDir, { recursive: true });
  try {
    const ctx = makeCtx("task_place", "Guardar informe en Documentos");
    const tools = [tool("write_file")];
    const srv: IMCPServer = {
      name: "desktop_commander",
      version: "t",
      listTools: async () => tools,
      callTool: async (_t, a) => {
        fs.writeFileSync(String(a.path), String(a.content ?? "datos"), "utf8");
        return { content: [{ type: "text", text: `Wrote ${String(a.path)}` }] };
      },
      isConnected: () => true,
      reconnect: async () => undefined,
    };
    let n = 0;
    const deps: EngineDeps = {
      discovery: {
        getServer: (name) => (name === "desktop_commander" ? srv : undefined),
        getDiscoveredTools: async () => tools,
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        chooseTool: async () => ({ action: "tool", tool: tools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
        reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
        // Sonda de lugar rechaza (wrong_place) después de poscondición cumplida en disco
        verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
        probe: async () => ({ probability: 0.1, rawInput: "", rawOutput: "" }),
        checkCompletion: async () => ({ requestComplete: 0, rawInput: "", rawOutput: "" }),
      },
      llm: {
        generatePendingFromView: async () => ({ pending: ["Guardar informe"], rawInput: "", rawOutput: "" }),
        generateArgumentsFromView: async () => ({
          args: { path: path.join(wrongDir, `informe_${n++}.txt`), content: "datos", mode: "rewrite" },
          rawInput: "",
          rawOutput: "",
          timing: TIMING,
        }),
        generatePlanFromView: async () => {
          throw new Error("no");
        },
        generateQuestion: async () => ({ question: "¿?", rawInput: "", rawOutput: "" }),
        generateFinalFromView: async () => ({ response: "No se realizaron cambios en la computadora. Intenté guardarlo.", rawInput: "", rawOutput: "" }),
      },
      vault: createRefVault({ dir: path.join(dir, "refs") }),
      guardScope: { protectedDirs: [], relativeBases: [dir] },
      blacklist: EMPTY_BLACKLIST,
      environment: async () => ({ platform: "linux", home: wrongDir }),
      autoMode: () => true,
      approvalTiers: () => false,
    };
    await runTask(ctx, new TaskRuntime(), deps);
    assert.equal(ctx.task.state, "partial");
    assert.equal(ctx.result?.origin, "model");
    assert.match(ctx.result?.text ?? "", /⚠/);
    assert.doesNotMatch(ctx.result?.text ?? "", /No se realizaron cambios/);
    assert.match(ctx.result?.text ?? "", /Quedaron escritos en:|Quedó escrito en:/);
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
        getServer: (n) => (n === "desktop_commander" ? srv(n, fileTools) : n === "jarvis_terminal" ? srv(n, termTools) : undefined),
        getDiscoveredTools: async (n) => (n === "desktop_commander" ? fileTools : n === "jarvis_terminal" ? termTools : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async (inp) => ({
          action: "route",
          route: stepNum === 1 ? "files" : inp.routes.includes("terminal") ? "terminal" : inp.routes[0],
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
      approvalTiers: () => false,
    };
    await runTask(ctx, new TaskRuntime(), deps);
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
    const fileTools = [tool("list_directory")];
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
        getServer: (n) => (n === "desktop_commander" ? srv(n, fileTools) : n === "jarvis_terminal" ? srv(n, termTools) : undefined),
        getDiscoveredTools: async (n) => (n === "desktop_commander" ? fileTools : n === "jarvis_terminal" ? termTools : []),
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
      approvalTiers: () => false,
    };

    // Fuerza maxVerifyRejectionsPerStep=2 por paso; como ambas rutas fallan en el mismo paso (files x2 -> routeExhausted -> terminal), verifica transición files -> terminal
    await runTask(ctx, new TaskRuntime(), deps);
    assert.ok(seenRoutes.some((r) => r.includes("files") && r.includes("terminal")));

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
      name: "desktop_commander",
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
        getServer: (n) => (n === "desktop_commander" ? bigSrv : undefined),
        getDiscoveredTools: async (n) => (n === "desktop_commander" ? [tool("write_file")] : []),
        getUnavailableServers: () => ({}),
        validateToolExists: async () => true,
        notifyTaskEnd: async () => undefined,
      },
      decision: {
        chooseRoute: async () => ({ action: "route", route: "files", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
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
      approvalTiers: () => false,
    };
    await runTask(ctxFinOver, new TaskRuntime(), depsFinOver);
    assert.equal(ctxFinOver.task.state, "completed");
    assert.equal(ctxFinOver.result?.origin, "fallback");
    assert.equal(llm3Called, 0, "si forFinal desborda la reserva, finalize usa fallback directo sin LLM 3");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
