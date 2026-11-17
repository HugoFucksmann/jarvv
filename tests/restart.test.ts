/**
 * Restauración al arrancar (`MEMORIA_CONTEXTO_DISENO.md` §6): una tarea que no estaba cerrada se cierra con `restart` (nunca se reanuda), las cerradas se listan
 * y se reconstruyen bajo demanda desde su log, y un log ilegible no se carga a medias ni se borra.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import type { JarvisConfig } from "../src/core/config.ts";
import { create } from "../src/core/ctx/index.ts";
import type { ContextLimits, TaskContext } from "../src/core/ctx/index.ts";
import type { EngineLLM } from "../src/core/contracts.ts";
import type { EngineServices } from "../src/core/engine/services.ts";
import { EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { createRefVault } from "../src/core/refs/refVault.ts";
import { openTaskLog, readTaskLog, taskLogPath } from "../src/core/taskLog.ts";
import { RESTART_RESULT_TEXT, TaskManager } from "../src/core/tasks.ts";

const LIMITS: ContextLimits = {
  summaryMax: BUDGET.summaryMax,
  argsStringMax: 2000,
  factValueMax: BUDGET.factValueMax,
  feedbackMax: BUDGET.feedbackMax,
  jsonMaxDepth: BUDGET.jsonMaxDepth,
};
const START = 1_700_000_000_000;

interface Root {
  readonly root: string;
  readonly tasksDir: string;
}

function tempRoot(): Root {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-restart-"));
  return { root, tasksDir: path.join(root, "data", "tasks") };
}

function manager({ root }: Root): TaskManager {
  const getConfig = (): JarvisConfig =>
    ({ traceEnabled: false, tracePath: path.join(root, "traces.jsonl"), refsDir: path.join(root, "data", "refs"), qwenModel: "q", decisionModel: "d", autoMode: false }) as JarvisConfig;
  const services: EngineServices = {
    vault: createRefVault({ dir: path.join(root, "data", "refs") }),
    guardScope: { protectedDirs: [], relativeBases: [root] },
    blacklist: EMPTY_BLACKLIST,
    environment: async () => ({ platform: "windows", home: "C:\\Users\\Ana" }),
    autoMode: () => false,
  };
  const never = async (): Promise<never> => {
    throw new Error("no se usa");
  };
  const llm: EngineLLM = { generateArgumentsFromView: never, generateQuestion: never, generatePendingFromView: never, generatePlanFromView: never, generateFinalFromView: never };
  const discovery = { getServer: () => undefined, getDiscoveredTools: async () => [], getUnavailableServers: () => ({}), validateToolExists: async () => false };
  const decision = { chooseRoute: never, chooseTool: never, reviewArgs: never, verifyResult: never, checkCompletion: never };
  return new TaskManager({ decision, discovery, llm }, getConfig, services);
}

/** Un log de tarea con su contexto; el reloj arranca en `startedAt` y avanza 1 s por `apply`. */
function openTask(tasksDir: string, id: string, startedAt = START): { readonly ctx: TaskContext; readonly file: string } {
  const log = openTaskLog(tasksDir, { id, mode: "reactive", request: `pedido ${id}`, startedAt, limits: LIMITS });
  let t = startedAt;
  let born = false;
  const ctx = create.context({ id, request: `pedido ${id}`, mode: "reactive" }, { ...LIMITS, now: () => (born ? (t += 1000) : ((born = true), startedAt)), onApply: log.onApply });
  return { ctx, file: log.filePath };
}

const STEP = { op: "add", target: "steps", value: { planId: null, instruction: "listar", route: null, expected: null } } as const;
const FINISH = { op: "finish", target: "task", value: { state: "completed", stopReason: null } } as const;
const RESULT = { op: "set", target: "result", value: { text: "Listo.", origin: "model" } } as const;

function closedTask(tasksDir: string, id: string, startedAt = START): string {
  const { ctx, file } = openTask(tasksDir, id, startedAt);
  ctx.apply(STEP);
  ctx.apply({ op: "update", target: "s1", value: { state: "running" } });
  ctx.apply({ op: "update", target: "s1", value: { state: "completed" } });
  ctx.apply(FINISH);
  ctx.apply(RESULT);
  return file;
}

const idOf = (n: number): string => `task_${1_700_000_000_000 + n}_x${String(n).padStart(3, "0")}`;

test("una tarea que estaba corriendo al apagarse se cierra con `restart`, deja su respuesta fija y se avisa; el log queda cerrado", () => {
  const r = tempRoot();
  const id = idOf(1);
  const { ctx, file } = openTask(r.tasksDir, id);
  ctx.apply(STEP);
  ctx.apply({ op: "update", target: "s1", value: { state: "running" } }); // la tarea se corta con un paso en curso

  const tasks = manager(r);
  const dto = tasks.get(id);
  assert.equal(dto?.task.state, "failed", "sin efectos: failed");
  assert.equal(dto?.task.stopReason, "restart");
  assert.equal(dto?.result?.text, RESTART_RESULT_TEXT);
  assert.equal(dto?.result?.origin, "fallback");
  assert.equal(dto?.steps[0].state, "failed", "el paso en curso no queda running");
  assert.deepEqual(tasks.interruptedOnStartup().map((t) => t.id), [id]);
  assert.equal(tasks.activeCount(), 0);

  const onDisk = readTaskLog(file);
  assert.ok(onDisk.ok && onDisk.ctx.isClosed() && onDisk.ctx.task.stopReason === "restart", "el cierre quedó escrito en el log");
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("una tarea cerrada pero sin respuesta recibe la respuesta fija y no se vuelve a cerrar", () => {
  const r = tempRoot();
  const id = idOf(2);
  const { ctx } = openTask(r.tasksDir, id);
  ctx.apply(FINISH); // cierre sin llegar a escribir la respuesta
  const tasks = manager(r);
  const dto = tasks.get(id);
  assert.equal(dto?.task.state, "completed", "el cierre original se respeta");
  assert.equal(dto?.task.stopReason, null);
  assert.equal(dto?.result?.text, RESTART_RESULT_TEXT);
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("una tarea cerrada con respuesta no se toca: el segundo arranque no avisa ni reescribe nada", () => {
  const r = tempRoot();
  const id = idOf(3);
  const file = closedTask(r.tasksDir, id);
  const before = fs.readFileSync(file, "utf8");
  const tasks = manager(r);
  assert.deepEqual(tasks.interruptedOnStartup(), []);
  assert.equal(tasks.get(id)?.task.state, "completed");
  assert.equal(fs.readFileSync(file, "utf8"), before);

  // Dos arranques seguidos con una tarea cortada: el segundo ya la encuentra cerrada.
  const cut = openTask(r.tasksDir, idOf(4));
  cut.ctx.apply(STEP);
  assert.equal(manager(r).interruptedOnStartup().length, 1);
  assert.equal(manager(r).interruptedOnStartup().length, 0);
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("con la cola del log cortada por el apagado, el cierre `restart` se escribe completo y el log sigue legible", () => {
  const r = tempRoot();
  const id = idOf(5);
  const { ctx, file } = openTask(r.tasksDir, id);
  ctx.apply(STEP);
  fs.appendFileSync(file, '{"n":2,"at":1700000002000,"ops":[{"op":"upd'); // corte a mitad del segundo registro
  const tasks = manager(r);
  assert.equal(tasks.get(id)?.task.stopReason, "restart");
  const again = readTaskLog(file);
  assert.ok(again.ok, again.ok ? "" : again.reason);
  if (again.ok) assert.equal(again.ctx.task.stopReason, "restart");
  assert.equal(manager(r).interruptedOnStartup().length, 0, "al reiniciar de nuevo ya está cerrada");
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("más de 20 tareas: las viejas cerradas se listan sin reproducirlas y se reconstruyen bajo demanda; las más recientes quedan en RAM", () => {
  const r = tempRoot();
  const ids = Array.from({ length: 24 }, (_, i) => idOf(100 + i));
  for (const [i, id] of ids.entries()) closedTask(r.tasksDir, id, START + i * 60_000);
  const tasks = manager(r);

  assert.equal(tasks.list().length, 24);
  assert.equal(tasks.taskIds().length, 20, "la caché de RAM tiene las 20 más recientes");
  assert.ok(!tasks.taskIds().includes(ids[0]) && tasks.taskIds().includes(ids[23]));
  const old = tasks.list().find((t) => t.id === ids[0]);
  assert.equal(old?.state, "completed");
  assert.equal(old?.request, `pedido ${ids[0]}`);
  assert.equal(old?.startedAt, START);
  assert.equal(old?.n, 5, "la versión coincide con la de la reproducción");
  assert.equal(tasks.get(ids[0])?.task.state, "completed", "se reconstruye desde el log al consultarla");
  assert.equal(tasks.get(ids[0])?.result?.text, "Listo.");
  assert.deepEqual(tasks.interruptedOnStartup(), []);
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("una tarea vieja cortada (fuera de las 20 recientes) también se cierra con `restart` al arrancar", () => {
  const r = tempRoot();
  const cutId = idOf(200);
  const { ctx } = openTask(r.tasksDir, cutId, START);
  ctx.apply(STEP);
  for (let i = 0; i < 22; i++) closedTask(r.tasksDir, idOf(300 + i), START + (i + 1) * 60_000);
  const tasks = manager(r);
  assert.deepEqual(tasks.interruptedOnStartup().map((t) => t.id), [cutId]);
  assert.equal(tasks.get(cutId)?.task.stopReason, "restart");
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("un log ilegible no se carga a medias, no figura en el listado y su archivo se conserva", () => {
  const r = tempRoot();
  const good = idOf(400);
  const bad = idOf(401);
  closedTask(r.tasksDir, good);
  const { ctx, file } = openTask(r.tasksDir, bad);
  ctx.apply(STEP);
  ctx.apply({ op: "update", target: "s1", value: { state: "running" } });
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines[1] = "no es json";
  fs.writeFileSync(file, lines.join("\n"));
  const before = fs.readFileSync(file, "utf8");

  const tasks = manager(r);
  assert.equal(tasks.get(bad), null);
  assert.deepEqual(tasks.list().map((t) => t.id), [good]);
  assert.equal(tasks.get(good)?.task.state, "completed", "las demás tareas no se ven afectadas");
  assert.equal(fs.readFileSync(taskLogPath(r.tasksDir, bad), "utf8"), before, "el archivo se conserva intacto");
  assert.deepEqual(tasks.interruptedOnStartup(), []);
  fs.rmSync(r.root, { recursive: true, force: true });
});

test("una tarea nueva escribe su log desde el primer registro y arranca con la cabecera completa", () => {
  const r = tempRoot();
  const tasks = manager(r);
  const dto = tasks.start("pedido nuevo", "reactive");
  const file = taskLogPath(r.tasksDir, dto.task.id);
  const header = JSON.parse(fs.readFileSync(file, "utf8").split("\n")[0]) as { id: string; mode: string; request: string; startedAt: number; limits: Record<string, number> };
  assert.equal(header.id, dto.task.id);
  assert.equal(header.mode, "reactive");
  assert.equal(header.request, "pedido nuevo");
  assert.equal(header.startedAt, dto.task.startedAt);
  assert.equal(header.limits.summaryMax, BUDGET.summaryMax);
  assert.equal(header.limits.recalledValueMax, BUDGET.recalledValueMax);
  return tasks.drain(3000).then(() => fs.rmSync(r.root, { recursive: true, force: true }));
});
