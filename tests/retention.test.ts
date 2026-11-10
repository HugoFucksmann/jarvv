/** Retención: se borran por antigüedad solo las carpetas que Jarvis creó, nunca archivos sueltos, lo protegido, lo reciente ni lo ajeno. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { JarvisConfig } from "../src/core/config.ts";
import { REFS_FOLDER, TRACE_FOLDER, pruneFolders, pruneTraceIndex, runRetention } from "../src/core/retention.ts";

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
  const config = (): JarvisConfig => ({ refsDir: docs, tracePath: path.join(root, "traces.jsonl"), retentionDays: 30 }) as JarvisConfig;

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

  const config = (retentionDays: number) => (): JarvisConfig => ({ refsDir, tracePath: path.join(root, "traces.jsonl"), retentionDays }) as JarvisConfig;

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

test("pruneTraceIndex: sin index.jsonl no hace nada", async () => {
  await pruneTraceIndex(path.join(os.tmpdir(), "no-existe-jarvis-xyz"));
});
