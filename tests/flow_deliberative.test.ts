/**
 * Pruebas de punta a punta del modo deliberativo (`runTask` + `planner.ts` + `runStep` planificado):
 * plan inicial, confirmación, feedback de usuario (válido, inválido y cancelación), fallos de paso con replanificación,
 * `replans_exhausted` (parcial vs fallido), `no_tools` y desborde en `forPlan`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import type { EngineDeps, GeneratedStep } from "../src/core/contracts.ts";
import { create } from "../src/core/ctx/index.ts";
import { LLMValidationError } from "../src/core/models/transport.ts";
import { runTask } from "../src/core/engine/runTask.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import type { Waiting } from "../src/core/engine/runtime.ts";
import type { IMCPServer } from "../src/core/mcp/types.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import type { MCPCallResult, MCPTool } from "../src/core/types.ts";

const TIMING = { start: 0, end: 0, durationMs: 0 } as never;
const SCHEMA = { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, mode: { type: "string" }, command: { type: "string" } } };
const tool = (name: string): MCPTool => ({ name, description: name, inputSchema: SCHEMA });

interface DelibScenario {
  readonly request: string;
  readonly plans: readonly (GeneratedStep[] | "invalid")[];
  readonly onWait?: (waiting: Waiting, runtime: TaskRuntime, index: number) => void;
  readonly callResult?: (tool: string, args: Record<string, unknown>, count: number) => MCPCallResult;
  readonly verify?: (tool: string, count: number) => { ok: number; cumple: number };
  readonly args?: (tool: string, stepInstruction: string, count: number) => Record<string, unknown>;
  readonly terminalTools?: MCPTool[];
  readonly memory?: { key: string; value: string }[];
  readonly bigEffectsForOverflow?: boolean;
}

async function runDelib(s: DelibScenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-delib-"));
  let planIdx = 0;
  let waitIdx = 0;
  let callIdx = 0;
  let verifyIdx = 0;
  let argsIdx = 0;
  const planTriggers: string[] = [];
  const dispatched: { tool: string; args: Record<string, unknown> }[] = [];

  const fileTools = ["list_directory", "read_file", "write_file"].map(tool);
  const terminalTools = s.terminalTools ?? [tool("run_command")];
  const makeServer = (name: string, tools: MCPTool[]): IMCPServer => ({
    name,
    version: "test",
    listTools: async () => tools,
    callTool: async (t, a) => {
      const idx = callIdx++;
      dispatched.push({ tool: t, args: a });
      if (s.callResult) return s.callResult(t, a, idx);
      if (s.bigEffectsForOverflow && t === "write_file") {
        return { content: [{ type: "text", text: "Z".repeat(2400) }] };
      }
      return { content: [{ type: "text", text: `ok ${t}` }] };
    },
    isConnected: () => true,
    reconnect: async () => undefined,
  });
  const servers: Record<string, IMCPServer> = {
    desktop_commander: makeServer("desktop_commander", fileTools),
    jarvis_terminal: makeServer("jarvis_terminal", terminalTools),
  };

  const deps: EngineDeps = {
    discovery: {
      getServer: (name) => servers[name],
      getDiscoveredTools: async (name) => (name === "desktop_commander" ? fileTools : name === "jarvis_terminal" ? terminalTools : []),
      getUnavailableServers: () => ({}),
      validateToolExists: async () => true,
      notifyTaskEnd: async () => undefined,
    },
    decision: {
      chooseRoute: async (input) => ({ action: "route", route: input.routes[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      chooseTool: async (input) => {
        const wanted =
          input.route === "terminal"
            ? "run_command"
            : input.step?.instruction?.toLowerCase().includes("escribir")
              ? "write_file"
              : input.tools[0].name;
        return {
          action: "tool",
          tool: input.tools.find((t) => t.name === wanted) ?? input.tools[0],
          probabilities: {},
          rawInput: "",
          rawOutput: "",
          shortcut: true,
        };
      },
      reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
      verifyResult: async (input) => {
        const toolName = input.call.split(/\s+/)[2]?.split("/")[1] ?? "";
        return { answers: s.verify?.(toolName, verifyIdx++) ?? { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" };
      },
      checkCompletion: async () => ({ requestComplete: 0, rawInput: "", rawOutput: "" }),
    },
    llm: {
      generatePlanFromView: async (input) => {
        planTriggers.push(input.trigger);
        const next = s.plans[planIdx++] ?? [];
        if (next === "invalid") throw new LLMValidationError("plan inválido simulado");
        return { steps: next, rawInput: "", rawOutput: "" };
      },
      generatePendingFromView: async () => {
        throw new Error("no se usa en deliberativo");
      },
      generateArgumentsFromView: async (input) => {
        const idx = argsIdx++;
        if (s.args) return { args: s.args(input.tool.name, input.view, idx), rawInput: "", rawOutput: "", timing: TIMING };
        if (input.tool.name === "write_file") return { args: { path: "C:\\Users\\Ana\\out.txt", content: s.bigEffectsForOverflow ? "B".repeat(1600) : "hola", mode: "rewrite" }, rawInput: "", rawOutput: "", timing: TIMING };
        if (input.tool.name === "run_command") return { args: { command: "Get-Date" }, rawInput: "", rawOutput: "", timing: TIMING };
        return { args: { path: "C:\\Users\\Ana" }, rawInput: "", rawOutput: "", timing: TIMING };
      },
      generateQuestion: async () => ({ question: "¿Confirmás?", rawInput: "", rawOutput: "" }),
      generateFinalFromView: async () => ({ response: "Plan completado.", rawInput: "", rawOutput: "" }),
    },
    memoryProvider: s.memory ? { recall: async () => s.memory! } : undefined,
    vault: createRefVault({ dir: path.join(dir, "refs") }),
    guardScope: { protectedDirs: [], relativeBases: [dir] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
    autoMode: () => true,
    approvalTiers: () => false,
  };

  let t = 1_700_000_000_000;
  const ctx = create.context(
    { id: "task_delib", request: s.request, mode: "deliberative" },
    { now: () => (t += 100), summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
  );
  const runtime = new TaskRuntime({
    onChange: (w) => {
      if (w) s.onWait?.(w, runtime, waitIdx++);
    },
  });

  try {
    await runTask(ctx, runtime, deps);
    return { ctx, planTriggers, dispatched };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("deliberativo feliz: memoria inicial + plan aprobado + múltiples pasos en orden → completed", async () => {
  const { ctx, planTriggers, dispatched } = await runDelib({
    request: "Listar y escribir archivo",
    memory: [{ key: "carpeta", value: "C:\\Users\\Ana" }],
    plans: [[
      { instruction: "Listar archivos", route: "files", expected: "lista" },
      { instruction: "Ejecutar fecha", route: "terminal", expected: "fecha" },
    ]],
    onWait: (w, rt) => {
      if (w.kind === "plan") rt.resolvePlanApproval(w.request.id, true);
    },
  });

  assert.deepEqual(planTriggers, ["initial"]);
  assert.equal(ctx.find("recalled", { source: "user_memory" }).length, 1);
  assert.equal(ctx.task.state, "completed");
  assert.equal(ctx.task.stopReason, null);
  assert.equal(dispatched.length, 2);
  assert.equal(ctx.find("steps", { state: "completed" }).length, 2);
});

test("deliberativo feedback: plan inválido tras rechazo conserva el plan previo y permite aprobar o cancelar después", async () => {
  const seenPlanIds: string[] = [];
  const { ctx, planTriggers } = await runDelib({
    request: "Plan con feedback y plan inválido intermedio",
    plans: [
      [{ instruction: "Paso A", route: "files", expected: "A" }],
      "invalid",
      [{ instruction: "Paso B revisado", route: "files", expected: "B" }],
    ],
    onWait: (w, rt, i) => {
      if (w.kind !== "plan") return;
      seenPlanIds.push(w.request.planId);
      if (i === 0) rt.resolvePlanApproval(w.request.id, false, "poné un paso B");
      else if (i === 1) rt.resolvePlanApproval(w.request.id, false, "intentá de nuevo");
      else rt.resolvePlanApproval(w.request.id, true);
    },
  });

  assert.deepEqual(planTriggers, ["initial", "user_feedback", "user_feedback"]);
  assert.equal(seenPlanIds[0], seenPlanIds[1], "ante plan inválido se vuelve a confirmar el plan p1 vigente");
  assert.notEqual(seenPlanIds[2], seenPlanIds[0]);
  assert.equal(ctx.find("steps", { superseded: true }).length, 1);
  assert.equal(ctx.task.state, "completed");
});

test("deliberativo: rechazar el plan sin instrucción cancela la tarea con respaldo", async () => {
  const { ctx } = await runDelib({
    request: "No quiero ejecutar",
    plans: [[{ instruction: "Paso", route: "files", expected: "ok" }]],
    onWait: (w, rt) => {
      if (w.kind === "plan") rt.resolvePlanApproval(w.request.id, false);
    },
  });
  assert.equal(ctx.task.state, "cancelled");
  assert.equal(ctx.task.stopReason, "user_cancelled");
  assert.equal(ctx.result?.origin, "fallback");
});

test("deliberativo step_failure: replan conserva el paso completado, reemplaza los pendientes y completa", async () => {
  const { ctx, planTriggers } = await runDelib({
    request: "Paso 1 bien en C:\\Users\\Ana, paso 2 falla, replan completa",
    plans: [
      [
        { instruction: "Paso 1 lectura", route: "files", expected: "datos" },
        { instruction: "Paso 2 comando fallido", route: "terminal", expected: "salida" },
        { instruction: "Paso 3 pendiente que se reemplaza", route: "files", expected: "listo" },
      ],
      [{ instruction: "Paso replanificado", route: "files", expected: "ok" }],
    ],
    onWait: (w, rt) => {
      if (w.kind === "plan") rt.resolvePlanApproval(w.request.id, true);
    },
    verify: (toolName) => (toolName === "run_command" ? { ok: 0.1, cumple: 0.1 } : { ok: 0.95, cumple: 0.95 }),
    args: (t, _view, i) => (t === "run_command" ? { command: `Get-Date -UFormat ${i}` } : { path: "C:\\Users\\Ana" }),
  });

  assert.deepEqual(planTriggers, ["initial", "step_failure"]);
  assert.equal(ctx.task.state, "completed");
  const steps = ctx.find("steps", {});
  assert.equal(steps[0].state, "completed");
  assert.equal(steps[0].superseded, false);
  assert.equal(steps[1].state, "failed");
  assert.equal(steps[1].superseded, true);
  assert.equal(steps[2].state, "pending");
  assert.equal(steps[2].superseded, true);
  assert.equal(steps[3].state, "completed");
  assert.equal(steps[3].superseded, false);
});

test("deliberativo: agota replans (replans_exhausted) → partial con efecto previo y failed sin efectos; replan inválido cierra replans_exhausted", async () => {
  const mkFailingPlans = (): GeneratedStep[][] =>
    Array.from({ length: BUDGET.maxReplans + 2 }, (_, idx) => [
      ...(idx === 0 ? [{ instruction: "Escribir primero", route: "files" as const, expected: "escrito" }] : []),
      { instruction: `Comando fallido ${idx}`, route: "terminal" as const, expected: "ok" },
    ]);

  // Con escritura aprobada previa en p1: al agotar replans cierra `partial`
  const withEffect = await runDelib({
    request: "Escribir y luego fallar siempre",
    plans: mkFailingPlans(),
    onWait: (w, rt) => {
      if (w.kind === "plan") rt.resolvePlanApproval(w.request.id, true);
    },
    verify: (t) => (t === "run_command" ? { ok: 0.1, cumple: 0.1 } : { ok: 0.95, cumple: 0.95 }),
    args: (t, _v, i) => (t === "write_file" ? { path: "C:\\Users\\Ana\\e.txt", content: "ok", mode: "rewrite" } : { command: `bad_${i}` }),
  });
  assert.equal(withEffect.ctx.task.stopReason, "replans_exhausted");
  assert.equal(withEffect.ctx.task.state, "partial");

  // Sin efectos previos (el comando falla con isError → tool_error) y replan inmediato inválido: cierra `failed` con `replans_exhausted`
  const invalidReplan = await runDelib({
    request: "Falla y replan inválido",
    plans: [[{ instruction: "Comando", route: "terminal", expected: "ok" }], "invalid"],
    onWait: (w, rt) => {
      if (w.kind === "plan") rt.resolvePlanApproval(w.request.id, true);
    },
    callResult: () => ({ isError: true, content: [{ type: "text", text: "error en el comando" }] }),
    args: (_t, _v, i) => ({ command: `cmd_${i}` }),
  });
  assert.equal(invalidReplan.ctx.task.stopReason, "replans_exhausted");
  assert.equal(invalidReplan.ctx.task.state, "failed");
});

test("deliberativo: plan inicial inválido cierra unrecoverable sin registrar error; no_tools en paso planificado dispara replan; forPlan desbordado cierra unrecoverable sin error", async () => {
  const badInitial = await runDelib({
    request: "Plan inicial imposible",
    plans: ["invalid"],
  });
  assert.equal(badInitial.ctx.task.state, "failed");
  assert.equal(badInitial.ctx.task.stopReason, "unrecoverable");
  assert.equal(badInitial.ctx.find("errors", {}).length, 0);

  // no_tools en terminal cuando terminal no tiene herramientas → falla paso 1 y replanifica a files
  const noToolsReplan = await runDelib({
    request: "Terminal vacío, replanifica a files",
    terminalTools: [],
    plans: [
      [{ instruction: "Correr en terminal", route: "terminal", expected: "algo" }],
      [{ instruction: "Listar en files", route: "files", expected: "algo" }],
    ],
    onWait: (w, rt) => {
      if (w.kind === "plan") rt.resolvePlanApproval(w.request.id, true);
    },
  });
  assert.deepEqual(noToolsReplan.planTriggers, ["initial", "step_failure"]);
  assert.equal(noToolsReplan.ctx.task.state, "completed");

  // Desborde de efectos en forPlan tras fallar el paso siguiente: cierra unrecoverable sin añadir error service_unavailable
  const overflowPlans: GeneratedStep[][] = [
    [
      ...Array.from({ length: 9 }, (_, i) => ({ instruction: `Escribir grande ${i}`, route: "files" as const, expected: "escrito" })),
      { instruction: "Falla después", route: "terminal" as const, expected: "ok" },
    ],
    [{ instruction: "No debería usarse", route: "files" as const, expected: "no" }],
  ];
  const overflow = await runDelib({
    request: "Desbordar forPlan al replanificar",
    plans: overflowPlans,
    bigEffectsForOverflow: true,
    onWait: (w, rt) => {
      if (w.kind === "plan") rt.resolvePlanApproval(w.request.id, true);
    },
    verify: (t) => (t === "run_command" ? { ok: 0.1, cumple: 0.1 } : { ok: 0.95, cumple: 0.95 }),
    args: (t, _v, i) => (t === "run_command" ? { command: `fail_${i}` } : { path: `C:\\Users\\Ana\\big${i}.txt`, content: "X".repeat(1600), mode: "rewrite" }),
  });
  assert.equal(overflow.ctx.task.stopReason, "unrecoverable");
  assert.equal(overflow.ctx.task.state, "partial");
  assert.equal(overflow.ctx.find("errors", {}).length, 0);
  assert.deepEqual(overflow.planTriggers, ["initial"]);
});
