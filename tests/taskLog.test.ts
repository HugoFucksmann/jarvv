/**
 * Log de eventos por tarea (`MEMORIA_CONTEXTO_DISENO.md` §5): cada `apply` se escribe antes de aplicarse, el contexto es un pliegue puro del log, un registro
 * cortado al final se descarta (y se repara antes de seguir escribiendo) y cualquier otra rotura marca la tarea como ilegible sin cargarla a medias.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import { create } from "../src/core/ctx/index.ts";
import type { ContextLimits, TaskContext } from "../src/core/ctx/index.ts";
import { terminalStateFor } from "../src/core/ctx/closure.ts";
import { LOG_SCHEMA_VERSION, listTaskLogFiles, openTaskLog, readTaskLog, summarizeClosedTaskLog, taskLogPath, tasksDirFromConfig } from "../src/core/taskLog.ts";

const LIMITS: ContextLimits = {
  summaryMax: BUDGET.summaryMax,
  argsStringMax: 2000,
  factValueMax: BUDGET.factValueMax,
  feedbackMax: BUDGET.feedbackMax,
  jsonMaxDepth: BUDGET.jsonMaxDepth,
  recalledKeyMax: BUDGET.recalledKeyMax,
  recalledValueMax: BUDGET.recalledValueMax,
  threadValueMax: BUDGET.threadValueMax,
};
const START = 1_700_000_000_000;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-log-"));
}

/** Una tarea con su log abierto: nace en `START` (como en `TaskManager.start`) y el reloj avanza 1 s por cada `apply`. */
function openTask(dir: string, id: string, limits: ContextLimits = LIMITS): { readonly ctx: TaskContext; readonly file: string } {
  const log = openTaskLog(dir, { id, mode: "reactive", request: "Listar mis archivos", startedAt: START, limits });
  let t = START;
  let born = false;
  const now = (): number => (born ? (t += 1000) : ((born = true), START));
  const ctx = create.context({ id, request: "Listar mis archivos", mode: "reactive" }, { ...limits, now, onApply: log.onApply });
  return { ctx, file: log.filePath };
}

const STEP = { op: "add", target: "steps", value: { planId: null, instruction: "listar", route: null, expected: null } } as const;
const RECALLED = { op: "add", target: "recalled", value: { stepId: null, source: "user_memory", key: "carpeta jarvis", value: "C:\\Users\\Ana\\jarvis", from: null } } as const;
const FINISH = { op: "finish", target: "task", value: { state: "completed", stopReason: null } } as const;
const RESULT = { op: "set", target: "result", value: { text: "Listo.", origin: "model" } } as const;

/** Una tarea cerrada y con respuesta, con pasos y `recalled` de por medio. */
function closedTask(dir: string, id: string): { readonly ctx: TaskContext; readonly file: string } {
  const task = openTask(dir, id);
  task.ctx.apply([STEP, RECALLED]);
  task.ctx.apply({ op: "update", target: "s1", value: { state: "running" } });
  task.ctx.apply({ op: "update", target: "s1", value: { state: "completed" } });
  task.ctx.apply(FINISH);
  task.ctx.apply(RESULT);
  return task;
}

const ID = "task_1700000000000_aaaa";

test("reproducir el log da el mismo contexto: instantes, ids, `recalled` y versión idénticos", () => {
  const dir = tempDir();
  const { ctx, file } = closedTask(dir, ID);
  const read = readTaskLog(file);
  assert.ok(read.ok, read.ok ? "" : read.reason);
  if (!read.ok) return;
  assert.deepEqual(read.ctx.snapshot(), ctx.snapshot());
  assert.equal(read.ctx.n, ctx.n);
  assert.equal(read.ctx.find("recalled", {})[0].key, "carpeta jarvis");
  assert.equal(read.ctx.find("recalled", {})[0].at, ctx.find("recalled", {})[0].at, "el instante sale del registro, no del reloj");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("reproducir no escribe en el log ni llama a `onApply` (solo con escritor vivo se sigue escribiendo, y después del pliegue)", () => {
  const dir = tempDir();
  const { file } = closedTask(dir, ID);
  const before = fs.readFileSync(file, "utf8");
  const plain = readTaskLog(file);
  assert.ok(plain.ok);
  assert.equal(fs.readFileSync(file, "utf8"), before, "leer no modifica el archivo");
  const live = readTaskLog(file, { attachLiveWriter: true });
  assert.ok(live.ok);
  assert.equal(fs.readFileSync(file, "utf8"), before, "el pliegue con escritor vivo tampoco reescribe lo ya registrado");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("la cabecera guarda los límites vigentes: subir o bajar un tope después no deja ilegible una tarea vieja", () => {
  const dir = tempDir();
  const tight: ContextLimits = { ...LIMITS, factValueMax: 20 };
  const { ctx, file } = openTask(dir, ID, tight);
  ctx.apply(STEP);
  ctx.apply({ op: "update", target: "s1", value: { state: "running" } });
  ctx.apply({ op: "set", target: "facts.process", value: { value: "x".repeat(20), stepId: "s1" } });
  const header = JSON.parse(fs.readFileSync(file, "utf8").split("\n")[0]) as { v: number; limits: ContextLimits };
  assert.equal(header.v, LOG_SCHEMA_VERSION);
  assert.equal(header.limits.factValueMax, 20);
  const read = readTaskLog(file);
  assert.ok(read.ok, read.ok ? "" : read.reason);
  if (read.ok) assert.deepEqual(read.ctx.snapshot(), ctx.snapshot());
  fs.rmSync(dir, { recursive: true, force: true });
});

test("escribir antes de aplicar: si el log falla, el contexto queda intacto", () => {
  let t = START;
  const ctx = create.context(
    { id: ID, request: "x", mode: "reactive" },
    {
      ...LIMITS,
      now: () => (t += 1000),
      onApply: () => {
        throw new Error("disco lleno (prueba)");
      },
    },
  );
  assert.throws(() => ctx.apply(STEP), /disco lleno/);
  assert.equal(ctx.n, 0);
  assert.equal(ctx.find("steps", {}).length, 0);
});

test("un último registro cortado se descarta al leer, y con escritor vivo se repara antes de seguir escribiendo", () => {
  const dir = tempDir();
  const { ctx, file } = openTask(dir, ID);
  ctx.apply(STEP);
  fs.appendFileSync(file, '{"n":2,"at":17000'); // el corte a mitad de un registro: sin cierre ni salto de línea

  const plain = readTaskLog(file);
  assert.ok(plain.ok, "la lectura simple lo descarta");
  if (plain.ok) assert.equal(plain.ctx.n, 1);
  assert.equal(fs.readFileSync(file, "utf8").endsWith('"at":17000'), true, "leer no repara");

  const live = readTaskLog(file, { attachLiveWriter: true });
  assert.ok(live.ok);
  assert.equal(fs.readFileSync(file, "utf8").endsWith("\n"), true, "la cola dañada se quitó");
  if (!live.ok) return;
  live.ctx.apply({ op: "finish", target: "task", value: { state: "failed", stopReason: "restart" } });
  live.ctx.apply({ op: "set", target: "result", value: { text: "reinicio", origin: "fallback" } });

  const again = readTaskLog(file);
  assert.ok(again.ok, "el cierre se escribió completo y el log sigue siendo legible");
  if (again.ok) {
    assert.equal(again.ctx.task.state, "failed");
    assert.equal(again.ctx.task.stopReason, "restart");
    assert.equal(again.ctx.n, 3);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("un registro completo sin salto de línea al final también se repara (el siguiente no queda pegado)", () => {
  const dir = tempDir();
  const { ctx, file } = openTask(dir, ID);
  ctx.apply(STEP);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\n$/, ""));
  const live = readTaskLog(file, { attachLiveWriter: true });
  assert.ok(live.ok);
  if (!live.ok) return;
  assert.equal(live.ctx.n, 1);
  live.ctx.apply({ op: "update", target: "s1", value: { state: "running" } });
  const again = readTaskLog(file);
  assert.ok(again.ok, again.ok ? "" : again.reason);
  if (again.ok) assert.equal(again.ctx.n, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("una rotura que no está al final marca la tarea como ilegible y conserva el archivo", () => {
  const dir = tempDir();
  const { ctx, file } = openTask(dir, ID);
  ctx.apply(STEP);
  ctx.apply({ op: "update", target: "s1", value: { state: "running" } });
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines[1] = lines[1].slice(0, 10); // el primer registro, cortado, con otro después
  fs.writeFileSync(file, lines.join("\n"));
  const before = fs.readFileSync(file, "utf8");
  const read = readTaskLog(file, { attachLiveWriter: true });
  assert.equal(read.ok, false);
  assert.equal(fs.readFileSync(file, "utf8"), before, "no se toca para poder inspeccionarlo");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("versión de esquema desconocida, cabecera inválida, archivo vacío y versión discontinua: ilegible", () => {
  const dir = tempDir();
  const { ctx, file } = openTask(dir, ID);
  ctx.apply(STEP);
  const lines = fs.readFileSync(file, "utf8").split("\n");

  const write = (name: string, content: string): string => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, content);
    return f;
  };
  const header = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(readTaskLog(write("task_1_v.jsonl", `${JSON.stringify({ ...header, v: 99 })}\n${lines[1]}\n`)).ok, false, "esquema futuro");
  assert.equal(readTaskLog(write("task_1_h.jsonl", `{"v":1}\n${lines[1]}\n`)).ok, false, "cabecera incompleta");
  assert.equal(readTaskLog(write("task_1_e.jsonl", "")).ok, false, "vacío");
  const skipped = JSON.parse(lines[1]) as Record<string, unknown>;
  assert.equal(readTaskLog(write("task_1_n.jsonl", `${lines[0]}\n${JSON.stringify({ ...skipped, n: 5 })}\n`)).ok, false, "n discontinuo");
  assert.equal(readTaskLog(path.join(dir, "no-existe.jsonl")).ok, false, "archivo ausente");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resumen rápido: coincide con la reproducción completa en una tarea cerrada y con respuesta", () => {
  const dir = tempDir();
  const { ctx, file } = closedTask(dir, ID);
  const summary = summarizeClosedTaskLog(file);
  assert.ok(summary !== null);
  if (summary === null) return;
  assert.deepEqual(summary, { id: ID, mode: "reactive", request: "Listar mis archivos", startedAt: START, state: ctx.task.state, stopReason: ctx.task.stopReason, n: ctx.n });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resumen rápido: una tarea abierta, sin respuesta o con la cola cortada no se resume (se reproduce completa)", () => {
  const dir = tempDir();
  const open = openTask(dir, "task_1700000000001_open");
  open.ctx.apply(STEP);
  assert.equal(summarizeClosedTaskLog(open.file), null, "abierta");

  const noResult = openTask(dir, "task_1700000000002_nores");
  noResult.ctx.apply(FINISH);
  assert.equal(summarizeClosedTaskLog(noResult.file), null, "cerrada pero sin respuesta");

  const torn = closedTask(dir, "task_1700000000003_torn");
  fs.appendFileSync(torn.file, '{"n":99');
  assert.equal(summarizeClosedTaskLog(torn.file), null, "cola cortada");
  assert.equal(summarizeClosedTaskLog(path.join(dir, "no-existe.jsonl")), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("listTaskLogFiles solo ve los archivos con el nombre de Jarvis, en orden de id", () => {
  const dir = tempDir();
  for (const id of ["task_1700000000002_bbbb", "task_1700000000001_aaaa"]) closedTask(dir, id);
  fs.writeFileSync(path.join(dir, "notas.jsonl"), "x");
  fs.writeFileSync(path.join(dir, "task_1700000000001_aaaa.jsonl.repair"), "x");
  assert.deepEqual(
    listTaskLogFiles(dir).map((f) => f.taskId),
    ["task_1700000000001_aaaa", "task_1700000000002_bbbb"],
  );
  assert.deepEqual(listTaskLogFiles(path.join(dir, "no-existe")), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("la carpeta del log sale de la carpeta padre de refsDir, igual que memory.json", () => {
  const dir = tasksDirFromConfig({ refsDir: path.join("datos", "refs"), traceDir: "x" } as never);
  assert.equal(dir, path.join(path.resolve("datos"), "tasks"));
  assert.equal(taskLogPath(dir, ID), path.join(dir, `${ID}.jsonl`));
});

test("`restart` cierra como `partial` si la tarea dejó efectos y como `failed` si no (misma tabla que `unrecoverable`)", () => {
  const write = { kind: "write", status: "ok", verdict: null } as never;
  const read = { kind: "read", status: "ok", verdict: "approved" } as never;
  assert.equal(terminalStateFor("restart", []), "failed");
  assert.equal(terminalStateFor("restart", [write]), "partial");
  assert.equal(terminalStateFor("restart", [read]), "partial", "una llamada aprobada con éxito también cuenta");
  assert.equal(terminalStateFor("restart", [write]), terminalStateFor("unrecoverable", [write]));
});
