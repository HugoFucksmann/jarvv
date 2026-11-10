/** TaskManager: ciclo de una tarea y cierre ordenado (`drain`): la traza queda escrita y una tarea colgada no demora el apagado más que el plazo. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { JarvisConfig } from "../src/core/config.ts";
import type { EngineLLM } from "../src/core/contracts.ts";
import type { EngineServices } from "../src/core/engine/services.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import { TaskManager } from "../src/core/tasks.ts";

function manager(root: string, pending: EngineLLM["generatePendingFromView"]): TaskManager {
  const getConfig = (): JarvisConfig => ({ traceEnabled: true, tracePath: path.join(root, "traces.jsonl"), qwenModel: "q", decisionModel: "d", autoMode: false }) as JarvisConfig;
  const services: EngineServices = {
    vault: createRefVault({ dir: path.join(root, "refs") }),
    guardScope: { protectedDirs: [], relativeBases: [root] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
    autoMode: () => false,
  };
  const llm: EngineLLM = {
    generateArgumentsFromView: async () => {
      throw new Error("no se usa");
    },
    generateQuestion: async () => {
      throw new Error("no se usa");
    },
    generatePendingFromView: pending,
    generatePlanFromView: async () => {
      throw new Error("no se usa");
    },
    generateFinalFromView: async () => ({ response: "Listo.", rawInput: "", rawOutput: "" }),
  };
  const discovery = { getServer: () => undefined, getDiscoveredTools: async () => [], getUnavailableServers: () => ({}), validateToolExists: async () => false };
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
  };
  return new TaskManager({ decision, discovery, llm }, getConfig, services);
}

test("una tarea sin nada que hacer se completa; drain espera a que su traza quede en disco", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-"));
  const tasks = manager(root, async () => ({ pending: [], rawInput: "", rawOutput: "" }));
  const dto = tasks.start("no hay nada que hacer", "reactive");
  assert.equal(dto.task.state, "running");
  assert.deepEqual(tasks.taskIds(), [dto.task.id]);

  await tasks.drain(3000);
  assert.notEqual(tasks.get(dto.task.id)?.task.state, "running");
  const traces = path.join(root, "traces");
  const folders = fs.readdirSync(traces).filter((n) => n !== "index.jsonl");
  assert.equal(folders.length, 1, "la traza se escribió antes de que drain devolviera");
  assert.ok(folders[0].endsWith(dto.task.id));
  fs.rmSync(root, { recursive: true, force: true });
});

test("drain sin tareas en curso devuelve al instante", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-"));
  const tasks = manager(root, async () => ({ pending: [], rawInput: "", rawOutput: "" }));
  const t0 = Date.now();
  await tasks.drain(5000);
  assert.ok(Date.now() - t0 < 500);
  fs.rmSync(root, { recursive: true, force: true });
});

test("drain no espera más que el plazo a una tarea colgada, aunque se la cancele", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-"));
  const tasks = manager(root, () => new Promise(() => undefined));
  const dto = tasks.start("se cuelga", "reactive");
  tasks.cancelAll();
  const t0 = Date.now();
  await tasks.drain(300);
  const waited = Date.now() - t0;
  assert.ok(waited >= 250 && waited < 2000, `esperó ${waited} ms`);
  assert.equal(tasks.get(dto.task.id)?.task.state, "running", "la tarea colgada sigue sin cerrar: el plazo manda");
  fs.rmSync(root, { recursive: true, force: true });
});

test("cancel y las decisiones sobre tareas o esperas inexistentes devuelven el código esperado", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tm-"));
  const tasks = manager(root, async () => ({ pending: [], rawInput: "", rawOutput: "" }));
  assert.equal(tasks.cancel("task_inexistente"), "unknown_task");
  assert.equal(tasks.approveCall("task_inexistente", "w1"), "unknown_task");
  const dto = tasks.start("x", "reactive");
  await tasks.drain(3000);
  assert.equal(tasks.approveCall(dto.task.id, "w1"), "not_waiting");
  assert.equal(tasks.answer(dto.task.id, "algo"), "not_waiting");
  fs.rmSync(root, { recursive: true, force: true });
});
