/**
 * Cobertura de flujo completo y etapas del motor que no estaban ejercitadas en `engine.test.ts`:
 * - Deliberativo: confirmación del plan (`user_feedback`, revisión inválida conservando plan vigente, rechazo sin feedback),
 *   plan inicial inválido, `maxReplans` agotados y replan inválido (`replans_exhausted`).
 * - Reactivo: abandono parcial por `maxItemFailures` (`partial` / `no_alternatives`), `escalationsExceeded`, `max_steps`,
 *   regla de lista vacía prematura (`pending.ts`) y `pending` inválido.
 * - Paso y `askUser`: `info_missing` desde D3, recorte + `RefVault` / `RefVaultError`, `askFirst` al llegar a `maxCallsPerStep`,
 *   y `repeatsApprovedCall`.
 * - Etapas D1 / D3 / `finalize`: `routeExhausted` en `availableRoutes`, `args_invalid` de D3, umbral estricto (`sensitiveApprove`),
 *   `overflow` sin `error` y `isLlmDown` evitando llamar a `generateFinalFromView`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import type { EngineDeps, EngineLLM, IActionDecision, IDiscoveryEngine, ReviewDecision } from "../src/core/contracts.ts";
import { create } from "../src/core/ctx/index.ts";
import type { TaskContext, TaskMode } from "../src/core/ctx/index.ts";
import { availableRoutes } from "../src/core/engine/callRunner.ts";
import { createEngineEnv } from "../src/core/engine/env.ts";
import { isLlmDown } from "../src/core/engine/failures.ts";
import { runTask } from "../src/core/engine/runTask.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import type { Waiting } from "../src/core/engine/runtime.ts";
import type { IMCPServer } from "../src/core/mcp/types.ts";
import {
  DecisionServiceUnavailableError,
  LLMServiceUnavailableError,
  LLMValidationError,
} from "../src/core/models/transport.ts";
import { EMPTY_BLACKLIST, compileBlacklist } from "../src/core/policy/blacklist.ts";
import { createRefVault, RefVaultError } from "../src/core/refs/refVault.ts";
import { toolResult } from "../src/core/tools/result.ts";
import type { MCPCallResult, MCPTool } from "../src/core/types.ts";

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
const tool = (name: string): MCPTool => ({ name, description: name, inputSchema: SCHEMA });
const FILE_TOOLS = ["list_directory", "read_file", "write_file"].map(tool);
const TERMINAL_TOOLS = ["run_command"].map(tool);

function makeCtx(request: string, mode: TaskMode): TaskContext {
  let clock = 1_700_000_000_000;
  return create.context(
    { id: `task_${Math.random().toString(36).slice(2, 8)}`, request, mode },
    { now: () => (clock += 1000), summaryMax: BUDGET.summaryMax, argsStringMax: 2000, factValueMax: BUDGET.factValueMax, feedbackMax: BUDGET.feedbackMax, jsonMaxDepth: BUDGET.jsonMaxDepth },
  );
}

interface HarnessOptions {
  readonly mode?: TaskMode;
  readonly request: string;
  readonly decision?: Partial<IActionDecision>;
  readonly llm?: Partial<EngineLLM>;
  readonly callTool?: (server: string, toolName: string, args: Record<string, unknown>, dir: string) => Promise<MCPCallResult>;
  readonly autoMode?: boolean;
  readonly approvalTiers?: boolean;
  readonly blacklist?: EngineDeps["blacklist"];
  readonly disk?: EngineDeps["disk"];
  readonly vaultPutOverride?: (taskId: string, text: string) => Promise<{ where: string; size: number }>;
  readonly onWait?: (waiting: Waiting, runtime: TaskRuntime) => void;
  /** Permite devolver argumentos respecto a `dir` (home temporal). */
  readonly argsFor?: (input: { readonly view: string }, dir: string) => Record<string, unknown>;
}

function makeDepsAndCtx(dir: string, opts: HarnessOptions) {
  const dispatched: { server: string; tool: string; args: Record<string, unknown> }[] = [];

  const makeServer = (name: string, tools: MCPTool[]): IMCPServer => ({
    name,
    version: "test",
    listTools: async () => tools,
    callTool: async (toolName, args) => {
      dispatched.push({ server: name, tool: toolName, args });
      if (opts.callTool) return opts.callTool(name, toolName, args, dir);
      return { content: [{ type: "text", text: "[FILE] ok.txt" }] };
    },
    isConnected: () => true,
    reconnect: async () => undefined,
  });

  const servers: Record<string, { server: IMCPServer; tools: MCPTool[] }> = {
    desktop_commander: { server: makeServer("desktop_commander", FILE_TOOLS), tools: FILE_TOOLS },
    jarvis_terminal: { server: makeServer("jarvis_terminal", TERMINAL_TOOLS), tools: TERMINAL_TOOLS },
    jarvis_web: { server: makeServer("jarvis_web", []), tools: [] },
  };

  const discovery: IDiscoveryEngine = {
    getServer: (n) => servers[n]?.server,
    getDiscoveredTools: async (n) => servers[n]?.tools ?? [],
    getUnavailableServers: () => ({}),
    validateToolExists: async () => true,
  };

  const baseVault = createRefVault({ dir });
  const vault = opts.vaultPutOverride ? { ...baseVault, put: opts.vaultPutOverride } : baseVault;

  const decision: IActionDecision = {
    chooseRoute: async (input) => ({ action: "route", route: input.routes[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
    chooseTool: async (input) => ({ action: "tool", tool: input.tools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
    reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
    verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
    checkCompletion: async () => ({ requestComplete: 0.95, rawInput: "", rawOutput: "" }),
    ...opts.decision,
  };

  let pendingCalls = 0;
  const llm: EngineLLM = {
    generateArgumentsFromView: async (input) => ({
      args: opts.argsFor ? opts.argsFor(input, dir) : { path: dir },
      rawInput: "",
      rawOutput: "",
      timing: TIMING,
    }),
    generateQuestion: async () => ({ question: "¿Qué dato falta?", rawInput: "", rawOutput: "" }),
    generatePendingFromView: async () => ({ pending: pendingCalls++ === 0 ? [opts.request] : [], rawInput: "", rawOutput: "" }),
    generatePlanFromView: async () => ({ steps: [{ instruction: opts.request, route: "files", expected: "listo" }], rawInput: "", rawOutput: "" }),
    generateFinalFromView: async () => ({ response: "Terminado.", rawInput: "", rawOutput: "" }),
    ...opts.llm,
  };

  const ctx = makeCtx(opts.request, opts.mode ?? "reactive");
  let runtime!: TaskRuntime;
  runtime = new TaskRuntime({
    onChange: (w) => {
      if (w !== null && opts.onWait) queueMicrotask(() => opts.onWait!(w, runtime));
    },
  });

  const deps: EngineDeps = {
    discovery,
    decision,
    llm,
    vault,
    guardScope: { protectedDirs: [], relativeBases: [dir] },
    blacklist: opts.blacklist ?? EMPTY_BLACKLIST,
    environment: async () => ({ platform: "linux", home: dir }),
    autoMode: () => opts.autoMode ?? false,
    approvalTiers: () => opts.approvalTiers ?? false,
    ...(opts.disk ? { disk: opts.disk } : {}),
  };

  return { ctx, runtime, deps, dispatched };
}

async function runHarness(opts: HarnessOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-flow-"));
  const { ctx, runtime, deps, dispatched } = makeDepsAndCtx(dir, opts);
  try {
    await runTask(ctx, runtime, deps);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { ctx, dispatched };
}

// ───────────────────────── Deliberativo: confirmPlan, invalid initial, maxReplans ─────────────────────────

test("deliberativo: feedback del usuario regenera el plan; revisión inválida conserva el vigente y vuelve a pedir confirmación", async () => {
  let planGenCalls = 0;
  const seenFirstStep: string[] = [];

  const { ctx } = await runHarness({
    mode: "deliberative",
    request: "Listar carpeta Documentos",
    llm: {
      generatePlanFromView: async (input) => {
        planGenCalls++;
        if (planGenCalls === 1) {
          assert.equal(input.trigger, "initial");
          return { steps: [{ instruction: "Plan A", route: "files", expected: "ok" }], rawInput: "", rawOutput: "" };
        }
        if (planGenCalls === 2) {
          assert.equal(input.trigger, "user_feedback");
          assert.ok(input.view.includes("Prefiero ver C:\\Docs"), "la vista del replan incluye el feedback");
          throw new LLMValidationError("JSON malformado en revisión");
        }
        return { steps: [{ instruction: "Plan B revisado", route: "files", expected: "ok" }], rawInput: "", rawOutput: "" };
      },
    },
    onWait: (w, rt) => {
      if (w.kind !== "plan") return;
      seenFirstStep.push(w.request.steps[0].instruction);
      if (seenFirstStep.length === 1) {
        rt.resolvePlanApproval(w.request.id, false, "Prefiero ver C:\\Docs");
      } else if (seenFirstStep.length === 2) {
        // La revisión #2 fue inválida: el plan vigente sigue siendo Plan A.
        assert.equal(w.request.steps[0].instruction, "Plan A");
        rt.resolvePlanApproval(w.request.id, false, "Ahora sí");
      } else {
        assert.equal(w.request.steps[0].instruction, "Plan B revisado");
        rt.resolvePlanApproval(w.request.id, true);
      }
    },
  });

  assert.equal(ctx.task.state, "completed");
  assert.equal(planGenCalls, 3);
  assert.deepEqual(seenFirstStep, ["Plan A", "Plan A", "Plan B revisado"]);
  const steps = ctx.find("steps", {});
  assert.equal(steps[0].superseded, true);
  assert.equal(steps[1].state, "completed");
});

test("deliberativo: rechazar el plan sin instrucción cancela la tarea (user_cancelled)", async () => {
  const { ctx, dispatched } = await runHarness({
    mode: "deliberative",
    request: "Crear carpeta",
    onWait: (w, rt) => {
      if (w.kind === "plan") rt.resolvePlanApproval(w.request.id, false);
    },
  });
  assert.equal(ctx.task.state, "cancelled");
  assert.equal(ctx.task.stopReason, "user_cancelled");
  assert.equal(ctx.result?.origin, "fallback");
  assert.equal(dispatched.length, 0);
});

test("deliberativo: plan inicial inválido cierra unrecoverable", async () => {
  const { ctx } = await runHarness({
    mode: "deliberative",
    request: "Plan imposible",
    llm: {
      generatePlanFromView: async () => {
        throw new LLMValidationError("plan vacío");
      },
    },
  });
  assert.equal(ctx.task.state, "failed");
  assert.equal(ctx.task.stopReason, "unrecoverable");
  // LLMValidationError (no Unavailable) conserva origin=model cuando generateFinalFromView responde.
  assert.equal(ctx.result?.origin, "model");
  assert.equal(ctx.find("plans", {}).length, 0);
});

test("deliberativo: agotar BUDGET.maxReplans (3) cierra con stopReason = replans_exhausted", async () => {
  let planGenCalls = 0;
  let seq = 0;
  const { ctx } = await runHarness({
    mode: "deliberative",
    request: "Intentar listar siempre fallando",
    decision: {
      verifyResult: async () => ({ answers: { ok: 0.05, cumple: 0.05 }, rawInput: "", rawOutput: "" }),
    },
    disk: { exists: () => true, isDirectory: () => true, size: () => 0 },
    llm: {
      generatePlanFromView: async () => {
        planGenCalls++;
        const n = planGenCalls;
        return { steps: [{ instruction: `Listar /tmp/sub_${n}_a o /tmp/sub_${n}_b`, route: "files", expected: "ok" }], rawInput: "", rawOutput: "" };
      },
    },
    // Cada llamada usa una ruta diferente presente en la instrucción del paso para no chocar con precheck ni con anti-loop.
    argsFor: () => ({ path: `/tmp/sub_${planGenCalls}_${++seq % 2 === 0 ? "a" : "b"}` }),
    onWait: (w, rt) => {
      if (w.kind === "plan") rt.resolvePlanApproval(w.request.id, true);
    },
  });

  assert.equal(planGenCalls, 1 + BUDGET.maxReplans, "1 plan inicial + maxReplans (3) replans");
  assert.equal(ctx.task.state, "failed");
  assert.equal(ctx.task.stopReason, "replans_exhausted");
});

test("deliberativo: replan inválido ante step_failure cierra con replans_exhausted", async () => {
  let planGenCalls = 0;
  let seq = 0;
  const { ctx } = await runHarness({
    mode: "deliberative",
    request: "Fallar y obtener replan inválido",
    decision: {
      verifyResult: async () => ({ answers: { ok: 0.05, cumple: 0.05 }, rawInput: "", rawOutput: "" }),
    },
    llm: {
      generatePlanFromView: async () => {
        planGenCalls++;
        if (planGenCalls === 1) return { steps: [{ instruction: "Listar A y B", route: "files", expected: "ok" }], rawInput: "", rawOutput: "" };
        throw new LLMValidationError("replan corrupto");
      },
    },
    argsFor: (_i, dir) => ({ path: seq++ === 0 ? dir : path.join(dir, "") }),
    onWait: (w, rt) => {
      if (w.kind === "plan") rt.resolvePlanApproval(w.request.id, true);
    },
  });

  assert.equal(planGenCalls, 2);
  assert.equal(ctx.task.state, "failed");
  assert.equal(ctx.task.stopReason, "replans_exhausted");
});

// ───────────────────────── Reactivo: abandono parcial, topes y pending vacío/inválido ─────────────────────────

test("reactivo: item que falla maxItemFailures (2) veces se abandona si hay otro pendiente; termina partial (no_alternatives)", async () => {
  let pendingQueries = 0;
  let aTries = 0;
  const { ctx, dispatched } = await runHarness({
    mode: "reactive",
    request: "Hacer tarea A y luego listar B",
    decision: {
      // D5 quisiera decir completo cuando quede vacía tras B, pero `abandoned > 0` debe cerrar partial.
      checkCompletion: async () => ({ requestComplete: 0.99, rawInput: "", rawOutput: "" }),
      verifyResult: async (input) => {
        const failA = input.call.includes("sub_a_");
        return { answers: failA ? { ok: 0.05, cumple: 0.05 } : { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" };
      },
    },
    llm: {
      generatePendingFromView: async () => {
        pendingQueries++;
        // Primer llamado: lista inicial [A, B]; tras fallo #1 de A reescribe A incluyendo /sub_a_1 y /sub_a_2 (misma similitud);
        // al fallar maxItemFailures (2) veces, el código abandona A sin consultar al LLM y sigue con B.
        if (pendingQueries === 1) return { pending: ["Fallar A en /sub_a_1", "Hacer B"], rawInput: "", rawOutput: "" };
        return { pending: ["Fallar A en /sub_a_2"], rawInput: "", rawOutput: "" };
      },
    },
    argsFor: ({ view }, dir) => {
      if (view.includes("Hacer B")) return { path: dir };
      aTries++;
      return { path: path.join(dir, `sub_a_${aTries}`) };
    },
  });

  assert.equal(ctx.task.state, "partial");
  assert.equal(ctx.task.stopReason, "no_alternatives");
  assert.ok(dispatched.some((d) => d.args.path !== undefined && !String(d.args.path).includes("sub_a_")), "B se ejecutó tras abandonar A");
  assert.equal(ctx.find("steps", { state: "failed" }).length, BUDGET.maxItemFailures);
  assert.equal(ctx.find("steps", { state: "completed" }).length, 1);
});

test("reactivo: más de maxEscalations (2) pasos fallidos cierra no_alternatives; maxSteps (20) cierra max_steps", async () => {
  // Caso 1: escalationsExceeded (> 2 pasos fallidos cuando solo queda 1 item; usando tool_error para variar o args distintos dentro de home)
  let seq = 0;
  const escRes = await runHarness({
    mode: "reactive",
    request: "Fallar siempre",
    decision: {
      verifyResult: async () => ({ answers: { ok: 0.05, cumple: 0.05 }, rawInput: "", rawOutput: "" }),
    },
    llm: {
      generatePendingFromView: async () => ({ pending: ["Único ítem"], rawInput: "", rawOutput: "" }),
    },
    // Cada llamada usa un subdirectorio distinto listado dentro de la carpeta home (`dir` es `home`, cuyo parent/hijos se aceptan o creamos subcarpetas).
    argsFor: (_i, dir) => {
      const sub = path.join(dir, `e_${++seq}`);
      fs.mkdirSync(sub, { recursive: true });
      return { path: sub };
    },
  });
  // Nota: precheck acepta subcarpetas si su nombre está en el texto o usamos `sources` del request; aseguramos que los paths estén en el request o pending:
  assert.equal(escRes.ctx.task.state, "failed");
  assert.equal(escRes.ctx.task.stopReason, "no_alternatives");
  assert.equal(escRes.ctx.find("steps", { state: "failed" }).length, BUDGET.maxEscalations + 1);

  // Caso 2: BUDGET.maxSteps (20) pasos completados sin terminar la lista -> cierra max_steps
  const stepNames: string[] = [];
  const stepPaths: Record<string, string> = {};
  const maxStepsRes = await runHarness({
    mode: "reactive",
    request: "Muchos pasos",
    llm: {
      generatePendingFromView: async () => ({
        pending: Array.from({ length: BUDGET.maxSteps + 2 }, (_, i) => `Listar paso_${i}`),
        rawInput: "",
        rawOutput: "",
      }),
    },
    argsFor: ({ view }, dir) => {
      const match = /Listar (paso_\d+)/.exec(view)?.[1] ?? `paso_${stepNames.length}`;
      stepNames.push(match);
      // Para no chocar con `isRepeat`, cada paso usa su propia ruta, incluida en `dir` + ya puesta en sources porque ponemos el path dentro de `pending`!
      // Más directo: las subcarpetas de `dir` creadas abajo usan la misma ruta si usamos una cadena de 20 pendientes con su propio nombre.
      if (!stepPaths[match]) {
        const p = path.join(dir, match);
        fs.mkdirSync(p, { recursive: true });
        stepPaths[match] = p;
      }
      return { path: stepPaths[match] };
    },
  });
  // `stepsExhausted` también aplica aunque algunos pasos hayan fallado o completado mientras sumen maxSteps (20):
  assert.equal(maxStepsRes.ctx.find("steps", {}).length, BUDGET.maxSteps);
  assert.equal(maxStepsRes.ctx.task.stopReason, "max_steps");
});

test("reactivo (pending.ts): lista vacía prematura reconsulta una vez; sin llamadas cierra completed, solo con fallos usa la solicitud entera", async () => {
  // 1. Con 0 llamadas y lista [] dos veces -> completed sin ejecutar herramientas
  let calls0 = 0;
  const noCalls = await runHarness({
    mode: "reactive",
    request: "No hagas nada",
    llm: {
      generatePendingFromView: async () => {
        calls0++;
        return { pending: [], rawInput: "", rawOutput: "" };
      },
    },
  });
  assert.equal(calls0, 2, "reconsulta exactamente una vez cuando viene vacía sin llamadas");
  assert.equal(noCalls.ctx.task.state, "completed");
  assert.equal(noCalls.dispatched.length, 0);

  // 2. Con solo fallos previos (closure === null): pending devuelve [] dos veces tras fallo -> cae a [ctx.task.request]
  let callsFail = 0;
  let toolExecs = 0;
  const recovered = await runHarness({
    mode: "reactive",
    request: "Ejecutar pedido completo",
    decision: {
      verifyResult: async () => ({ answers: { ok: 0.95, cumple: 0.95 }, rawInput: "", rawOutput: "" }),
      checkCompletion: async () => ({ requestComplete: 0.99, rawInput: "", rawOutput: "" }),
    },
    llm: {
      generatePendingFromView: async () => {
        callsFail++;
        return { pending: callsFail === 1 ? ["Primer intento fallido"] : [], rawInput: "", rawOutput: "" };
      },
    },
    callTool: async () => {
      toolExecs++;
      return toolExecs <= 2
        ? { isError: true, content: [{ type: "text", text: "EBUSY: busy" }] }
        : { content: [{ type: "text", text: "[FILE] ok.txt" }] };
    },
  });
  // Con EBUSY: intento 1 -> tool_error (reintenta mismo paso 1), intento 2 -> tool_error -> maxVerifyRejectionsPerStep(2) -> paso 1 FAILED.
  // Tras paso 1 FAILED: pending llama #2 (`[]`), premature (`closure === null`), reconsulta #3 (`[]`) -> cae a `[ctx.task.request]`.
  // Paso 2 (`"Ejecutar pedido completo"`): llama con `{ path: dir }`? Como pasó fallos transitorios y es otro paso (o pongamos otro tool/dir): termina OK y D5 cierra!
  assert.equal(callsFail, 3, "1 inicial + 2 vacías prematuras tras el paso fallido");
  assert.equal(recovered.ctx.task.state, "completed");
  assert.equal(recovered.ctx.find("steps", {})[1].instruction, "Ejecutar pedido completo");
});

test("reactivo: pending inválido cierra unrecoverable", async () => {
  const { ctx } = await runHarness({
    mode: "reactive",
    request: "Pedido roto en pending",
    llm: {
      generatePendingFromView: async () => {
        throw new LLMValidationError("JSON inválido");
      },
    },
  });
  assert.equal(ctx.task.state, "failed");
  assert.equal(ctx.task.stopReason, "unrecoverable");
  assert.equal(ctx.result?.origin, "model");
});

// ───────────────────────── askUser + stepLoop (info_missing, refVault, askFirst, repeatsApprovedCall) ─────────────────────────

test("askUser + D3 info_missing: pregunta al usuario, escribe fact answer y reintenta hasta aprobar", async () => {
  let reviews = 0;
  let askedQuestion = "";
  const seenAnswers: string[] = [];

  const { ctx, dispatched } = await runHarness({
    mode: "reactive",
    request: "Guardar nota",
    autoMode: true,
    decision: {
      chooseTool: async (input) => ({ action: "tool", tool: input.tools.find((t) => t.name === "write_file")!, probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      reviewArgs: async (input): Promise<ReviewDecision> => {
        reviews++;
        if (reviews === 1) return { review: "info_missing", probabilities: { info_missing: 0.95, approved: 0.02, args_invalid: 0.03 }, rawInput: "", rawOutput: "" };
        seenAnswers.push(...input.userInput);
        return { review: "approved", probabilities: { approved: 0.98 }, rawInput: "", rawOutput: "" };
      },
    },
    // `disk` reporta que `dir/nota.txt` existe tras escribirse para que N5 postcondition apruebe sin depender de IO real del mock.
    disk: { exists: (p) => p.endsWith("nota.txt") || !p.includes("nota.txt"), isDirectory: (p) => !p.endsWith(".txt"), size: () => 5 },
    llm: {
      generateQuestion: async () => ({ question: "¿En qué carpeta lo guardo?", rawInput: "", rawOutput: "" }),
    },
    argsFor: (_i, dir) => ({ path: path.join(dir, "nota.txt"), content: "hola", mode: "rewrite" }),
    onWait: (w, rt) => {
      if (w.kind === "question") {
        askedQuestion = w.question.question;
        rt.answer("En nota.txt");
      }
    },
  });

  assert.equal(ctx.task.state, "completed");
  assert.equal(askedQuestion, "¿En qué carpeta lo guardo?");
  assert.equal(dispatched.length, 1);
  assert.equal(ctx.find("calls", { status: "info_missing" }).length, 1);
  assert.ok(seenAnswers.some((u) => u.includes("En nota.txt")));
});

test("askUser: respuesta > BUDGET.factValueMax guarda ref; fallo en vault deja el hecho recortado y cierra unrecoverable", async () => {
  const longAnswer = "A".repeat(BUDGET.factValueMax + 80);

  // 1. Vault ok: guarda ref y continúa
  let reviewsOk = 0;
  const okRes = await runHarness({
    mode: "reactive",
    request: "Guardar texto largo",
    autoMode: true,
    decision: {
      chooseTool: async (input) => ({ action: "tool", tool: input.tools.find((t) => t.name === "write_file")!, probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      reviewArgs: async (): Promise<ReviewDecision> => (++reviewsOk === 1 ? { review: "info_missing", probabilities: { info_missing: 0.9 }, rawInput: "", rawOutput: "" } : { review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
    },
    disk: { exists: () => true, isDirectory: (p) => !p.endsWith(".txt"), size: () => 5 },
    argsFor: (_i, dir) => ({ path: path.join(dir, "nota.txt"), content: "hola", mode: "rewrite" }),
    onWait: (w, rt) => {
      if (w.kind === "question") rt.answer(longAnswer);
    },
  });
  assert.equal(okRes.ctx.task.state, "completed");
  assert.equal(okRes.ctx.find("refs", {}).length, 1);

  // 2. Vault falla con RefVaultError: conserva hecho recortado y cierra unrecoverable
  const errRes = await runHarness({
    mode: "reactive",
    request: "Guardar texto largo con vault caído",
    autoMode: true,
    vaultPutOverride: async () => {
      throw new RefVaultError("write_failed", "sin espacio");
    },
    decision: {
      chooseTool: async (input) => ({ action: "tool", tool: input.tools.find((t) => t.name === "write_file")!, probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      reviewArgs: async () => ({ review: "info_missing", probabilities: { info_missing: 0.9 }, rawInput: "", rawOutput: "" }),
    },
    argsFor: (_i, dir) => ({ path: path.join(dir, "nota.txt"), content: "hola", mode: "rewrite" }),
    onWait: (w, rt) => {
      if (w.kind === "question") rt.answer(longAnswer);
    },
  });
  assert.equal(errRes.ctx.task.state, "failed");
  assert.equal(errRes.ctx.task.stopReason, "unrecoverable");
  assert.ok(Object.keys(errRes.ctx.snapshot().facts).some((k) => k.startsWith("answer_")), "hecho recortado conservado");
  assert.equal(errRes.ctx.find("errors", {}).some((e) => e.kind === "service_unavailable"), true);
});

test("stepLoop: al llegar a BUDGET.maxCallsPerStep pregunta al usuario (askFirst) antes de fallar el paso", async () => {
  let promptAskedCount = 0;
  let modelQuestionAsked = 0;
  let cmdSeq = 0;
  const capRes = await runHarness({
    mode: "reactive",
    request: "Ejecutar comando interactivo que nunca termina",
    autoMode: true,
    callTool: async () =>
      toolResult({
        text: "status: waiting_input · pid: 77",
        raw: "status: waiting_input · pid: 77",
        data: { state: "waiting_input", pid: 77, exitCode: null, prompt: "Siguiente?" },
      }),
    decision: {
      chooseRoute: async () => ({ action: "route", route: "terminal", probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      chooseTool: async (input) => ({ action: "tool", tool: input.tools[0], probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      reviewArgs: async () => ({ review: "approved", probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
    },
    llm: {
      generatePendingFromView: async () => ({ pending: ["Correr"], rawInput: "", rawOutput: "" }),
      generateQuestion: async () => {
        modelQuestionAsked++;
        return { question: "¿Qué está pasando?", rawInput: "", rawOutput: "" };
      },
    },
    argsFor: () => ({ command: `echo paso_${++cmdSeq}` }),
    onWait: (w, rt) => {
      if (w.kind === "question") {
        if (w.question.question.includes("¿Qué está pasando?")) rt.answer("cancelar");
        else {
          promptAskedCount++;
          rt.answer(`r_${promptAskedCount}`);
        }
      }
    },
  });
  assert.equal(promptAskedCount, BUDGET.maxProcessPromptsPerStep * (BUDGET.maxEscalations + 1));
  assert.equal(modelQuestionAsked, BUDGET.maxEscalations + 1, "askFirst preguntó al usuario una vez por paso al alcanzar maxCallsPerStep");
  assert.equal(capRes.ctx.find("calls", { stepId: capRes.ctx.find("steps", {})[0].id }).length, BUDGET.maxCallsPerStep);
});

test("stepLoop (repeatsApprovedCall): pedir exactamente la misma lectura ya aprobada en el paso anterior cierra el paso como completed", async () => {
  let pendingRound = 0;
  const { ctx, dispatched } = await runHarness({
    mode: "reactive",
    request: "Leer archivo y verificar",
    llm: {
      generatePendingFromView: async () => {
        pendingRound++;
        return { pending: pendingRound === 1 ? ["Paso 1 leer carpeta", "Paso 2 verificar carpeta"] : [], rawInput: "", rawOutput: "" };
      },
    },
  });

  assert.equal(ctx.task.state, "completed");
  assert.equal(dispatched.length, 1, "solo se despachó una vez");
  const steps = ctx.find("steps", {});
  assert.equal(steps.length, 2);
  assert.equal(steps[1].state, "completed");
  assert.equal(ctx.find("calls", { stepId: steps[1].id })[0].status, "loop_blocked");
});

// ───────────────────────── D1 routeExhausted, D3 rechazos y umbral estricto, overflow y LLM down ─────────────────────────

test("D1 availableRoutes: 2 rechazos not_accomplished agotan una ruta; si todas se agotan, vuelve a ofrecerlas", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-route-ex-"));
  try {
    const { ctx, runtime, deps } = makeDepsAndCtx(dir, { mode: "reactive", request: "Probar ruta agotada" });
    const env = createEngineEnv(ctx, runtime, deps);
    const stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "Paso", route: null, expected: null } }).ids[0];

    assert.deepEqual(await availableRoutes(env, stepId, ["files", "terminal"]), ["files", "terminal"]);

    for (let i = 0; i < BUDGET.maxNotAccomplishedPerRoute; i++) {
      const cid = ctx.apply({
        op: "add",
        target: "calls",
        value: { stepId, route: "files", tool: "list_directory", kind: "read", args: {}, sig: `f${i}`, status: "ok", summary: "ok", ref: null },
      }).ids[0];
      ctx.apply({ op: "update", target: cid, value: { verdict: "rejected", reason: "not_accomplished" } });
    }
    assert.deepEqual(await availableRoutes(env, stepId, ["files", "terminal"]), ["terminal"], "files queda excluida al agotarse");

    for (let i = 0; i < BUDGET.maxNotAccomplishedPerRoute; i++) {
      const cid = ctx.apply({
        op: "add",
        target: "calls",
        value: { stepId, route: "terminal", tool: "run_command", kind: "read", args: {}, sig: `t${i}`, status: "ok", summary: "ok", ref: null },
      }).ids[0];
      ctx.apply({ op: "update", target: cid, value: { verdict: "rejected", reason: "not_accomplished" } });
    }
    assert.deepEqual(await availableRoutes(env, stepId, ["files", "terminal"]), ["files", "terminal"], "si no queda ninguna, restaura todas");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("D3 reviewArgs: 2 args_invalid fallan el paso (review_rejected); umbral estricto (tier yellow + sensitive) 0.62 -> tool_rejected", async () => {
  // 1. 2 args_invalid -> step failed
  const invRes = await runHarness({
    mode: "reactive",
    request: "Escribir nota.txt",
    autoMode: true,
    decision: {
      chooseTool: async (input) => ({ action: "tool", tool: input.tools.find((t) => t.name === "write_file")!, probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      reviewArgs: async () => ({ review: "args_invalid", probabilities: { approved: 0.1, args_invalid: 0.85, info_missing: 0.05 }, rawInput: "", rawOutput: "" }),
    },
    argsFor: (_i, dir) => ({ path: path.join(dir, "nota.txt"), content: "x", mode: "rewrite" }),
  });
  const s0 = invRes.ctx.find("steps", {})[0];
  assert.equal(s0.state, "failed");
  assert.equal(invRes.ctx.find("calls", { stepId: s0.id, status: "args_invalid" }).length, BUDGET.maxReviewRejectionsPerStep);

  // 2. Umbral estricto (sensitiveApprove = 0.65) con lista negra `sensitive` en autoMode (o tier yellow):
  // Probabilidad approved = 0.62 (>= 0.60, < 0.65) -> tool_rejected (NO args_invalid), luego rewrite pasa con 0.90.
  const black = compileBlacklist([{ tool: "write_file", pattern: "append", level: "sensitive", reason: "Revisión estricta en append" }]);
  let argAttempt = 0;
  const strictRes = await runHarness({
    mode: "reactive",
    request: "Agregar texto a nota.txt",
    autoMode: true,
    blacklist: black,
    disk: { exists: () => true, isDirectory: (p) => !p.endsWith(".txt"), size: () => 5 },
    decision: {
      chooseTool: async (input) => ({ action: "tool", tool: input.tools.find((t) => t.name === "write_file")!, probabilities: {}, rawInput: "", rawOutput: "", shortcut: true }),
      reviewArgs: async () => ({
        review: "approved",
        probabilities: argAttempt === 1 ? { approved: 0.62, args_invalid: 0.3, info_missing: 0.08 } : { approved: 0.9, args_invalid: 0.05, info_missing: 0.05 },
        rawInput: "",
        rawOutput: "",
      }),
    },
    argsFor: (_i, dir) => {
      argAttempt++;
      return { path: path.join(dir, "nota.txt"), content: "hola", mode: argAttempt === 1 ? "append" : "rewrite" };
    },
  });
  const calls = strictRes.ctx.find("calls", {});
  assert.equal(calls[0].status, "tool_rejected");
  assert.match(calls[0].summary ?? "", /Revisión estricta en append/);
  assert.equal(strictRes.ctx.task.state, "completed");
});

test("failures + finalize: overflow cierra unrecoverable sin error; LLMServiceUnavailable marca isLlmDown y salta LLM 3", async () => {
  // 1. Overflow en LLM de argumentos: cierra unrecoverable SIN entry en errors
  const overRes = await runHarness({
    mode: "reactive",
    request: "Listar",
    llm: {
      generateArgumentsFromView: async () => {
        throw new LLMValidationError("overflow", undefined, undefined, true);
      },
    },
  });
  assert.equal(overRes.ctx.task.state, "failed");
  assert.equal(overRes.ctx.task.stopReason, "unrecoverable");
  assert.equal(overRes.ctx.find("errors", {}).length, 0);

  // 2. LLMServiceUnavailableError marca isLlmDown -> finalize no llama a generateFinalFromView
  let finalCalls = 0;
  const downRes = await runHarness({
    mode: "reactive",
    request: "Listar",
    llm: {
      generateArgumentsFromView: async () => {
        throw new LLMServiceUnavailableError("Ollama caído");
      },
      generateFinalFromView: async () => {
        finalCalls++;
        return { response: "no debe llamarse", rawInput: "", rawOutput: "" };
      },
    },
  });
  assert.equal(isLlmDown(downRes.ctx), true);
  assert.equal(downRes.ctx.task.state, "failed");
  assert.equal(downRes.ctx.task.stopReason, "unrecoverable");
  assert.equal(downRes.ctx.result?.origin, "fallback");
  assert.equal(finalCalls, 0);

  // 3. DecisionServiceUnavailableError en D1 cierra con error service_unavailable
  const decDown = await runHarness({
    mode: "reactive",
    request: "Listar",
    decision: {
      chooseRoute: async () => {
        throw new DecisionServiceUnavailableError("D3 caído");
      },
    },
  });
  assert.equal(decDown.ctx.task.state, "failed");
  assert.equal(decDown.ctx.task.stopReason, "unrecoverable");
  assert.equal(decDown.ctx.find("errors", {}).length, 1);
  assert.equal(decDown.ctx.find("errors", {})[0].kind, "service_unavailable");
});
