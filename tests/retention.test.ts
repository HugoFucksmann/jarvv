/** Retención: se borran por antigüedad solo las carpetas que Jarvis creó, nunca archivos sueltos, lo protegido, lo reciente ni lo ajeno. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { JarvisConfig } from "../src/core/config.ts";
import { BUDGET } from "../src/core/budget.ts";
import { create } from "../src/core/ctx/index.ts";
import type { ContextLimits } from "../src/core/ctx/index.ts";
import { REFS_FOLDER, TRACE_FOLDER, pruneFolders, pruneLogFiles, pruneTraceIndex, runRetention } from "../src/core/retention.ts";
import { LOG_FILE, openTaskLog } from "../src/core/taskLog.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 9);

const VIEJA = "task_1700000000000_abcd";
const NUEVA = "task_1799999999999_wxyz";
const VIVA = "task_1700000000001_live";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-ret-"));
}

/** Carpeta con un archivo y una antigüedad dada en días. */
function folder(base: string, name: string, ageDays: number): void {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "a.txt"), "x");
  const when = new Date(NOW - ageDays * DAY);
  fs.utimesSync(dir, when, when);
}

test("los patrones de nombre son los de los ids y las carpetas de traza reales", () => {
  assert.ok(REFS_FOLDER.test(VIEJA));
  assert.ok(TRACE_FOLDER.test(`20261109-191737_${VIEJA}`));
  for (const ajeno of ["Documentos", "node_modules", "task_x", "task_123", ".git", "20261109_task_1_a"]) {
    assert.equal(REFS_FOLDER.test(ajeno) || TRACE_FOLDER.test(ajeno), false, ajeno);
  }
});

test("pruneFolders borra solo lo viejo con nombre de Jarvis: no toca lo reciente, lo protegido, lo ajeno ni los archivos sueltos", async () => {
  const base = tempDir();
  folder(base, VIEJA, 40);
  folder(base, NUEVA, 5);
  folder(base, VIVA, 90);
  folder(base, "Documentos", 400);
  fs.writeFileSync(path.join(base, "index.jsonl"), "{}\n");
  const old = new Date(NOW - 90 * DAY);
  fs.utimesSync(path.join(base, "index.jsonl"), old, old);

  const removed = await pruneFolders(base, REFS_FOLDER, 30 * DAY, NOW, (name) => name === VIVA);
  assert.deepEqual(removed, [VIEJA]);
  assert.deepEqual(fs.readdirSync(base).sort(), ["Documentos", "index.jsonl", NUEVA, VIVA].sort());
  fs.rmSync(base, { recursive: true, force: true });
});

test("pruneFolders: una carpeta inexistente no es un error", async () => {
  assert.deepEqual(await pruneFolders(path.join(os.tmpdir(), "no-existe-jarvis-xyz"), REFS_FOLDER, DAY, NOW), []);
});

test("runRetention: si refsDir apunta a una carpeta del usuario no borra nada que Jarvis no haya creado", async () => {
  const root = tempDir();
  const docs = path.join(root, "Documentos");
  folder(docs, "Fotos 2019", 900);
  folder(docs, "Facturas", 900);
  folder(docs, VIEJA, 900);
  const config = (): JarvisConfig => ({ refsDir: docs, traceDir: path.join(root, "traces"), retentionDays: 30 }) as JarvisConfig;

  await runRetention(config, () => [], NOW);
  assert.deepEqual(fs.readdirSync(docs).sort(), ["Facturas", "Fotos 2019"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("runRetention: aplica retentionDays a refs y trazas, protege las refs de tareas retenidas, limpia index.jsonl y 0 desactiva", async () => {
  const root = tempDir();
  const refsDir = path.join(root, "refs");
  const traces = path.join(root, "traces");
  folder(refsDir, VIVA, 60);
  folder(refsDir, VIEJA, 60);
  folder(refsDir, NUEVA, 1);
  folder(traces, `20260101-000000_${VIEJA}`, 60);
  folder(traces, `20261108-000000_${NUEVA}`, 1);
  const index = [
    { taskId: VIEJA, folder: `20260101-000000_${VIEJA}` },
    { taskId: NUEVA, folder: `20261108-000000_${NUEVA}` },
  ].map((e) => JSON.stringify(e));
  fs.writeFileSync(path.join(traces, "index.jsonl"), `${index.join("\n")}\nlínea ilegible\n`);

  const config = (retentionDays: number) => (): JarvisConfig => ({ refsDir, traceDir: path.join(root, "traces"), retentionDays }) as JarvisConfig;

  await runRetention(config(0), () => [], NOW);
  assert.equal(fs.readdirSync(refsDir).length, 3, "0 no borra nada");

  await runRetention(config(30), () => [VIVA], NOW);
  assert.deepEqual(fs.readdirSync(refsDir).sort(), [NUEVA, VIVA].sort());
  assert.deepEqual(fs.readdirSync(traces).sort(), [`20261108-000000_${NUEVA}`, "index.jsonl"].sort());
  const lines = fs.readFileSync(path.join(traces, "index.jsonl"), "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 2, "queda la línea de la traza que existe y la ilegible");
  assert.ok(lines[0].includes(NUEVA));
  fs.rmSync(root, { recursive: true, force: true });
});

test("pruneTraceIndex: sin index.jsonl no hace nada ni crea archivos", async () => {
  const missing = path.join(os.tmpdir(), "no-existe-jarvis-xyz");
  await assert.doesNotReject(() => pruneTraceIndex(missing));
  assert.equal(fs.existsSync(path.join(missing, "index.jsonl")), false);
});

// ───────────────────────── Logs de eventos de las tareas ─────────────────────────

const LOG_LIMITS: ContextLimits = { summaryMax: BUDGET.summaryMax, argsStringMax: 2000, factValueMax: BUDGET.factValueMax, feedbackMax: BUDGET.feedbackMax, jsonMaxDepth: BUDGET.jsonMaxDepth };

/** Un log de tarea con la antigüedad dada; `closed` lo cierra con respuesta y `pad` agranda la cabecera (para probar el tope de tamaño). */
function logFile(tasksDir: string, id: string, ageDays: number, options: { readonly closed?: boolean; readonly pad?: number } = {}): string {
  const request = `pedido ${id}${"x".repeat(options.pad ?? 0)}`;
  const log = openTaskLog(tasksDir, { id, mode: "reactive", request, startedAt: NOW - ageDays * DAY, limits: LOG_LIMITS });
  let t = NOW - ageDays * DAY;
  let born = false;
  const ctx = create.context({ id, request, mode: "reactive" }, { ...LOG_LIMITS, now: () => (born ? (t += 1000) : ((born = true), NOW - ageDays * DAY)), onApply: log.onApply });
  ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "listar", route: null, expected: null } });
  if (options.closed !== false) {
    ctx.apply({ op: "finish", target: "task", value: { state: "completed", stopReason: null } });
    ctx.apply({ op: "set", target: "result", value: { text: "Listo.", origin: "model" } });
  }
  const when = new Date(NOW - ageDays * DAY);
  fs.utimesSync(log.filePath, when, when);
  return log.filePath;
}

const configWith = (root: string, extra: Partial<JarvisConfig>) => (): JarvisConfig =>
  ({ refsDir: path.join(root, "data", "refs"), traceDir: path.join(root, "traces"), retentionDays: 10, logRetentionDays: 30, retentionMaxMb: 0, ...extra }) as JarvisConfig;

test("los logs se reconocen por el nombre que Jarvis les da: `<id de tarea>.jsonl`", () => {
  assert.ok(LOG_FILE.test(`${VIEJA}.jsonl`));
  for (const ajeno of ["notas.jsonl", "index.jsonl", `${VIEJA}.txt`, `${VIEJA}.jsonl.repair`, "task_x.jsonl"]) assert.equal(LOG_FILE.test(ajeno), false, ajeno);
});

test("pruneLogFiles borra solo logs viejos de tareas cerradas: no toca los recientes, los protegidos, los de tareas sin cerrar ni archivos ajenos", async () => {
  const root = tempDir();
  const tasksDir = path.join(root, "data", "tasks");
  const old = logFile(tasksDir, VIEJA, 40);
  logFile(tasksDir, NUEVA, 5);
  logFile(tasksDir, VIVA, 90);
  const open = logFile(tasksDir, "task_1700000000009_open", 90, { closed: false });
  fs.writeFileSync(path.join(tasksDir, "notas.jsonl"), "x");
  const ancient = new Date(NOW - 400 * DAY);
  fs.utimesSync(path.join(tasksDir, "notas.jsonl"), ancient, ancient);

  const removed = await pruneLogFiles(tasksDir, 30 * DAY, NOW, (id) => id === VIVA);
  assert.deepEqual(removed, [`${VIEJA}.jsonl`]);
  assert.equal(fs.existsSync(old), false);
  assert.ok(fs.existsSync(open), "una tarea sin cerrar nunca pierde su log");
  assert.deepEqual(fs.readdirSync(tasksDir).sort(), ["notas.jsonl", `${NUEVA}.jsonl`, "task_1700000000009_open.jsonl", `${VIVA}.jsonl`].sort());
  assert.deepEqual(await pruneLogFiles(path.join(tasksDir, "no-existe"), DAY, NOW), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("runRetention: refs y trazas a los 10 días, el log a los 30 (cada uno con su propia antigüedad)", async () => {
  const root = tempDir();
  const refsDir = path.join(root, "data", "refs");
  const tasksDir = path.join(root, "data", "tasks");
  folder(refsDir, VIEJA, 20);
  folder(path.join(root, "traces"), `20261020-000000_${VIEJA}`, 20);
  logFile(tasksDir, VIEJA, 20);
  const veryOld = "task_1600000000000_zzzz";
  logFile(tasksDir, veryOld, 40);

  await runRetention(configWith(root, {}), () => [], NOW);
  assert.equal(fs.existsSync(path.join(refsDir, VIEJA)), false, "las refs de 20 días se borran");
  assert.deepEqual(fs.readdirSync(path.join(root, "traces")).filter((n) => n !== "index.jsonl"), [], "la traza de 20 días se borra");
  assert.deepEqual(fs.readdirSync(tasksDir), [`${VIEJA}.jsonl`], "el log de 20 días queda y el de 40 se borra");
  fs.rmSync(root, { recursive: true, force: true });
});

test("runRetention: el log de una tarea retenida en memoria no se borra, y logRetentionDays 0 no borra logs por antigüedad", async () => {
  const root = tempDir();
  const tasksDir = path.join(root, "data", "tasks");
  logFile(tasksDir, VIVA, 90);
  logFile(tasksDir, VIEJA, 90);
  await runRetention(configWith(root, {}), () => [VIVA], NOW);
  assert.deepEqual(fs.readdirSync(tasksDir), [`${VIVA}.jsonl`]);

  logFile(tasksDir, VIEJA, 90);
  await runRetention(configWith(root, { logRetentionDays: 0 }), () => [], NOW);
  assert.deepEqual(fs.readdirSync(tasksDir).sort(), [`${VIEJA}.jsonl`, `${VIVA}.jsonl`].sort(), "sin días de log no se borra nada por antigüedad");
  fs.rmSync(root, { recursive: true, force: true });
});

test("runRetention: el tope de tamaño es compartido entre refs, trazas y logs: se borra lo más antiguo primero y nunca lo protegido ni lo no cerrado", async () => {
  const root = tempDir();
  const refsDir = path.join(root, "data", "refs");
  const tasksDir = path.join(root, "data", "tasks");
  const big = (dir: string, name: string, ageDays: number): void => {
    folder(dir, name, ageDays);
    fs.writeFileSync(path.join(dir, name, "grande.txt"), "x".repeat(600_000));
    const when = new Date(NOW - ageDays * DAY);
    fs.utimesSync(path.join(dir, name), when, when);
  };
  const oldestRefs = "task_1700000000100_refs";
  const middleLog = "task_1700000000200_logg";
  const newestRefs = "task_1700000000300_newr";
  big(refsDir, oldestRefs, 6);
  logFile(tasksDir, middleLog, 4, { pad: 600_000 });
  big(refsDir, newestRefs, 1);
  const open = logFile(tasksDir, "task_1700000000400_open", 8, { closed: false, pad: 600_000 });

  // ~2,4 MB entre las cuatro cosas; con un tope de 2 MB sobra lo más antiguo que se puede borrar: las refs de 6 días.
  await runRetention(configWith(root, { retentionDays: 0, logRetentionDays: 0, retentionMaxMb: 2 }), () => [], NOW);
  assert.equal(fs.existsSync(path.join(refsDir, oldestRefs)), false, "lo más antiguo borrable (refs de 6 días) se va primero");
  assert.ok(fs.existsSync(path.join(tasksDir, `${middleLog}.jsonl`)) && fs.existsSync(path.join(refsDir, newestRefs)), "lo más nuevo se conserva al bajar del tope");
  assert.ok(fs.existsSync(open), "el log de una tarea sin cerrar no se borra aunque sea el más antiguo");

  // Con un tope de 1 MB se sigue en orden (el log de 4 días, después las refs de 1 día) y se corta lo que se puede: el log abierto, que no se puede borrar, queda aunque el total siga sobre el tope.
  await runRetention(configWith(root, { retentionDays: 0, logRetentionDays: 0, retentionMaxMb: 1 }), () => [], NOW);
  assert.equal(fs.existsSync(path.join(tasksDir, `${middleLog}.jsonl`)), false, "los logs cuentan para el tope y se borran por antigüedad");
  assert.equal(fs.existsSync(path.join(refsDir, newestRefs)), false, "después se borran las refs más nuevas: sigue sobre el tope");
  assert.ok(fs.existsSync(open), "el log de la tarea sin cerrar queda");
  fs.rmSync(root, { recursive: true, force: true });
});
