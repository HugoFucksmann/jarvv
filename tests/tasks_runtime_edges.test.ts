/** TaskManager (`closeOnDefect`, `prune`, `remember`, `waitId` estricto, `list`) y mapeos de error/estado de `jarvisRouter`. */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import express from "express";

import { ConfigManager, type JarvisConfig } from "../src/core/config.ts";
import type { EngineLLM, IDiscoveryEngine } from "../src/core/contracts.ts";
import type { EngineServices } from "../src/core/engine/services.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import { taskLogPath } from "../src/core/taskLog.ts";
import { TaskManager, type TaskDto, type TaskSummary } from "../src/core/tasks.ts";
import { MAX_RETAINED_TASKS } from "../src/core/types/limits.ts";
import { apiErrorHandler, createJarvisRouter } from "../src/server/jarvisRouter.ts";

function makeTempEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-edges-"));
  const base = ConfigManager.getConfig();
  const getConfig = (): JarvisConfig => ({
    ...base,
    traceEnabled: false,
    tracePath: path.join(root, "traces.jsonl"),
    refsDir: path.join(root, "data", "refs"),
    qwenModel: "q",
    decisionModel: "d",
    autoMode: false,
    approvalTiers: false,
    allowedDirectories: [],
  });
  const services: EngineServices = {
    vault: createRefVault({ dir: path.join(root, "data", "refs") }),
    guardScope: { protectedDirs: [], relativeBases: [root] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: "linux", home: root }),
    autoMode: () => false,
  };
  return { root, getConfig, services };
}

test("TaskManager.closeOnDefect: un defecto no esperado en runTask cierra la tarea como unrecoverable sin colgar drain()", async () => {
  const { root, getConfig, services } = makeTempEnv();
  const llm: EngineLLM = {
    generateArgumentsFromView: async () => {
      throw new Error("no se usa");
    },
    generateQuestion: async () => {
      throw new Error("no se usa");
    },
    // Defecto de programación ajeno a LLMValidationError/LLMServiceUnavailableError: escapa de runTask.
    generatePendingFromView: async () => {
      throw new TypeError("bug simulado en runtime");
    },
    generatePlanFromView: async () => {
      throw new Error("no se usa");
    },
    generateFinalFromView: async () => ({ response: "ok", rawInput: "", rawOutput: "" }),
  };
  const discovery: IDiscoveryEngine = {
    getServer: () => undefined,
    getDiscoveredTools: async () => [],
    getUnavailableServers: () => ({}),
    validateToolExists: async () => false,
  };
  const decision = {
    chooseRoute: async () => {
      throw new Error("no se usa");
    },
    chooseTool: async () => {
      throw new Error("no se usa");
    },
    reviewArgs: async () => {
      throw new Error("no se usa");
    },
    verifyResult: async () => {
      throw new Error("no se usa");
    },
    checkCompletion: async () => {
      throw new Error("no se usa");
    },
  };

  const tasks = new TaskManager({ decision, discovery, llm }, getConfig, services);
  const dto = tasks.start("provocar defecto", "reactive");
  await tasks.drain(3000);

  const after = tasks.get(dto.task.id);
  assert.equal(after?.task.state, "failed");
  assert.equal(after?.task.stopReason, "unrecoverable");
  assert.equal(after?.result?.origin, "fallback");
  fs.rmSync(root, { recursive: true, force: true });
});

test("TaskManager.prune: expulsa terminadas manteniendo reconstrucción desde disco, y limpia list() si falta el archivo", async () => {
  const { root, getConfig, services } = makeTempEnv();
  const llm: EngineLLM = {
    generateArgumentsFromView: async () => {
      throw new Error("no se usa");
    },
    generateQuestion: async () => {
      throw new Error("no se usa");
    },
    generatePendingFromView: async () => ({ pending: [], rawInput: "", rawOutput: "" }),
    generatePlanFromView: async () => {
      throw new Error("no se usa");
    },
    generateFinalFromView: async () => ({ response: "Hecho.", rawInput: "", rawOutput: "" }),
  };
  const discovery: IDiscoveryEngine = {
    getServer: () => undefined,
    getDiscoveredTools: async () => [],
    getUnavailableServers: () => ({}),
    validateToolExists: async () => false,
  };
  const decision = {
    chooseRoute: async () => {
      throw new Error("no se usa");
    },
    chooseTool: async () => {
      throw new Error("no se usa");
    },
    reviewArgs: async () => {
      throw new Error("no se usa");
    },
    verifyResult: async () => {
      throw new Error("no se usa");
    },
    checkCompletion: async () => {
      throw new Error("no se usa");
    },
  };

  const tasks = new TaskManager({ decision, discovery, llm }, getConfig, services);
  const createdIds: string[] = [];
  for (let i = 0; i < MAX_RETAINED_TASKS + 3; i++) {
    const dto = tasks.start(`tarea ${i}`, "reactive");
    createdIds.push(dto.task.id);
    await tasks.drain(3000);
  }

  assert.equal(tasks.taskIds().length, MAX_RETAINED_TASKS, "en RAM quedan como máximo MAX_RETAINED_TASKS");
  assert.equal(tasks.list().length, MAX_RETAINED_TASKS + 3, "list() conserva todas las existentes");
  assert.equal(tasks.taskIds().includes(createdIds[0]), false, "la más antigua cerrada fue expulsada de RAM");
  assert.equal(tasks.get(createdIds[0])?.result?.text, "Hecho.", "pero se reconstruye completa desde su log");

  // Si un agente externo/retención borra el log en disco de una tarea ya expulsada, list() la retira del listado.
  const tasksDir = path.join(root, "data", "tasks");
  fs.rmSync(taskLogPath(tasksDir, createdIds[0]));
  assert.equal(tasks.list().some((t) => t.id === createdIds[0]), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test("TaskManager.prune: si se excede el tope solo con tareas en espera, cancela la espera más antigua", async () => {
  const { root, getConfig, services } = makeTempEnv();
  const waitingObserved = new Set<string>();
  const llm: EngineLLM = {
    generateArgumentsFromView: async () => {
      throw new Error("no se usa");
    },
    generateQuestion: async () => {
      throw new Error("no se usa");
    },
    generatePendingFromView: async () => ({ pending: ["hacer algo"], rawInput: "", rawOutput: "" }),
    generatePlanFromView: async () => ({
      steps: [{ instruction: "listar", route: "files", expected: "listado" }],
      rawInput: "",
      rawOutput: "",
    }),
    generateFinalFromView: async () => ({ response: "Fin.", rawInput: "", rawOutput: "" }),
  };
  const discovery: IDiscoveryEngine = {
    getServer: () => undefined,
    getDiscoveredTools: async () => [],
    getUnavailableServers: () => ({}),
    validateToolExists: async () => false,
  };
  const decision = {
    chooseRoute: async () => {
      throw new Error("no se usa");
    },
    chooseTool: async () => {
      throw new Error("no se usa");
    },
    reviewArgs: async () => {
      throw new Error("no se usa");
    },
    verifyResult: async () => {
      throw new Error("no se usa");
    },
    checkCompletion: async () => {
      throw new Error("no se usa");
    },
  };

  const tasks = new TaskManager({ decision, discovery, llm }, getConfig, services);
  const waitPromises: Promise<void>[] = [];
  const ids: string[] = [];

  for (let i = 0; i < MAX_RETAINED_TASKS; i++) {
    let resolveWait!: () => void;
    waitPromises.push(new Promise<void>((r) => (resolveWait = r)));
    const off = tasks.addEventListener((e) => {
      if (e.type === "waiting" && e.waiting !== null && !waitingObserved.has(e.taskId)) {
        waitingObserved.add(e.taskId);
        resolveWait();
        off();
      }
    });
    // Modo deliberativo entra rápido en `waiting` ("plan") tras `generatePlanFromView`.
    const dto = tasks.start(`plan ${i}`, "deliberative");
    ids.push(dto.task.id);
  }
  await Promise.all(waitPromises);

  // Esta tarea número MAX_RETAINED_TASKS + 1 fuerza a `prune()` a cancelar la primera tarea en espera (`ids[0]`).
  const extra = tasks.start("plan extra", "deliberative");
  for (let i = 0; i < 40 && tasks.get(ids[0])?.task.state === "running"; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(tasks.get(ids[0])?.task.state, "cancelled", "la espera más antigua se canceló por tope de retención");
  assert.equal(tasks.get(ids[0])?.task.stopReason, "user_cancelled");
  assert.equal(tasks.get(ids[1])?.task.state, "running", "las restantes siguen vivas");

  tasks.cancelAll();
  await tasks.drain(3000);
  assert.notEqual(tasks.get(extra.task.id)?.task.state, "running");
  fs.rmSync(root, { recursive: true, force: true });
});

test("TaskManager: waitId estricto rechaza esperas ajenas y approveCall(remember=true) recuerda aprobaciones en la tarea", async () => {
  const { root, getConfig, services } = makeTempEnv();
  let argCall = 0;
  const writeTool = {
    name: "write_file",
    description: "Escribe archivo",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  };
  let mcpExecutions = 0;
  const discovery: IDiscoveryEngine = {
    getServer: () => ({
      name: "jarvis_files",
      version: "1",
      isConnected: () => true,
      reconnect: async () => undefined,
      listTools: async () => [writeTool],
      callTool: async (_name, args) => {
        mcpExecutions++;
        fs.writeFileSync(String(args.path), String(args.content ?? ""));
        return { content: [{ type: "text", text: "ok" }], isError: false };
      },
    }),
    getDiscoveredTools: async (s) => (s === "jarvis_files" ? [writeTool] : []),
    getUnavailableServers: () => ({}),
    validateToolExists: async (s, t) => s === "jarvis_files" && t === "write_file",
  };
  const llm: EngineLLM = {
    generatePendingFromView: async () => ({ pending: ["Escribir cabecera inicial", "Agregar sección final"], rawInput: "", rawOutput: "" }),
    generatePlanFromView: async () => {
      throw new Error("no se usa");
    },
    generateArgumentsFromView: async () => {
      argCall++;
      // Mismo destino: con `remember=true`, la segunda llamada NO debe volver a pedir confirmación al usuario.
      return {
        args: { path: path.join(root, "mismo.txt"), content: `v${argCall}` },
        rawInput: "",
        rawOutput: "",
        timing: { startedAt: 0, durationMs: 0 },
      };
    },
    generateQuestion: async () => ({ question: "?", rawInput: "", rawOutput: "" }),
    generateFinalFromView: async () => ({ response: "Escritos.", rawInput: "", rawOutput: "" }),
  };
  const decision = {
    chooseRoute: async () => ({ action: "route" as const, route: "files" as const, probabilities: { files: 1 }, rawInput: "", rawOutput: "" }),
    chooseTool: async () => ({ action: "tool" as const, tool: writeTool, probabilities: { write_file: 1 }, rawInput: "", rawOutput: "" }),
    reviewArgs: async () => ({ review: "approved" as const, probabilities: { approved: 1 }, rawInput: "", rawOutput: "" }),
    verifyResult: async () => ({ answers: { ok: 1, cumple: 1 }, rawInput: "", rawOutput: "" }),
    checkCompletion: async () => ({ requestComplete: 1, rawInput: "", rawOutput: "" }),
  };

  const tasks = new TaskManager({ decision, discovery, llm }, getConfig, services);
  let approvalsPrompted = 0;
  let badWaitChecked = false;
  const off = tasks.addEventListener((e) => {
    if (e.type !== "waiting" || e.waiting?.kind !== "approval") return;
    approvalsPrompted++;
    if (!badWaitChecked) {
      badWaitChecked = true;
      assert.equal(tasks.approveCall(e.taskId, "wait_id_ajeno"), "not_waiting", "un waitId distinto no resuelve la espera");
      assert.equal(tasks.approvePlan(e.taskId, e.waiting.request.id), "not_waiting", "una orden de plan no resuelve una aprobación");
    }
    assert.equal(tasks.approveCall(e.taskId, e.waiting.request.id, true), "ok");
  });

  const dto = tasks.start("escribe dos veces el mismo archivo", "reactive");
  await tasks.drain(3000);
  off();

  const done = tasks.get(dto.task.id);
  assert.equal(done?.task.state, "completed");
  assert.equal(mcpExecutions, 2);
  assert.equal(approvalsPrompted, 1, "la segunda escritura idéntica reutilizó remember=true sin volver a preguntar");
  fs.rmSync(root, { recursive: true, force: true });
});

test("jarvisRouter: valida entradas con 400, mapea ControlResult (404/409) y captura error en refresh-discovery", async () => {
  const summaries: TaskSummary[] = [
    { id: "task_open", mode: "reactive", request: "r", state: "running", stopReason: null, startedAt: 1, n: 1, waiting: null },
  ];
  const fakeTasks = {
    activeCount: () => 0,
    start: (message: string, mode: string) => ({ task: { id: "t1", request: message, mode } }) as unknown as TaskDto,
    list: () => summaries,
    cancel: (id: string) => (id === "missing" ? "unknown_task" : "not_waiting"),
    approvePlan: (id: string) => (id === "missing" ? "unknown_task" : "not_waiting"),
    modifyPlan: () => "not_waiting",
    rejectPlan: () => "ok",
    approveCall: (id: string) => (id === "missing" ? "unknown_task" : "not_waiting"),
    denyCall: () => "ok",
    answer: (id: string) => (id === "missing" ? "unknown_task" : "not_waiting"),
    addEventListener: () => () => undefined,
  } as unknown as TaskManager;

  const fakeDiscovery = {
    discoverAll: async () => {
      throw new Error("fallo discovery");
    },
    getUnavailableServers: () => ({}),
  } as unknown as IDiscoveryEngine;

  const app = express();
  app.use(express.json());
  app.use("/api/jarvis", createJarvisRouter(fakeTasks, fakeDiscovery as never));
  app.use("/api", apiErrorHandler);
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as AddressInfo).port;

  const call = (method: string, route: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, json: (await r.json()) as Record<string, unknown> }));

  try {
    assert.equal((await call("POST", "/api/jarvis/process", { message: "   " })).status, 400);
    assert.equal((await call("POST", "/api/jarvis/process", { message: "hola", mode: "invalido" })).status, 400);
    assert.equal((await call("POST", "/api/jarvis/modify-plan", { taskId: "task_open", waitId: "w1", feedback: "   " })).status, 400);
    assert.equal((await call("POST", "/api/jarvis/user-answer", { answer: "   " })).status, 400);

    // Mapeo ControlResult: unknown_task -> 404, not_waiting -> 409
    assert.equal((await call("POST", "/api/jarvis/approve", { taskId: "missing", waitId: "w1" })).status, 404);
    assert.equal((await call("POST", "/api/jarvis/approve", { taskId: "task_open", waitId: "w1" })).status, 409);
    assert.equal((await call("POST", "/api/jarvis/confirm-plan", { taskId: "task_open", waitId: "w1" })).status, 409);
    assert.equal((await call("POST", "/api/jarvis/user-answer", { taskId: "missing", answer: "sí" })).status, 404);
    assert.equal((await call("POST", "/api/jarvis/user-answer", { taskId: "task_open", answer: "sí" })).status, 409);

    // /cancel: tarea inexistente -> 404; tarea que ya no espera -> 200 ok
    assert.equal((await call("POST", "/api/jarvis/cancel", { taskId: "missing" })).status, 404);
    const cancelClosed = await call("POST", "/api/jarvis/cancel", { taskId: "task_open" });
    assert.equal(cancelClosed.status, 200);
    assert.equal(cancelClosed.json.ok, true);

    // /refresh-discovery con error devuelve 200 con { tools: {}, error }
    const refresh = await call("POST", "/api/jarvis/refresh-discovery");
    assert.equal(refresh.status, 200);
    assert.deepEqual(refresh.json.tools, {});
    assert.equal(refresh.json.error, "fallo discovery");
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
});
