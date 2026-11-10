/** Retención: se borran por antigüedad solo las subcarpetas, nunca archivos sueltos, lo protegido ni lo reciente. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { JarvisConfig } from "../src/core/config.ts";
import { pruneFolders, runRetention } from "../src/core/retention.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 9);

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

test("pruneFolders borra las carpetas viejas y conserva las recientes, los archivos sueltos y lo protegido", async () => {
  const base = tempDir();
  folder(base, "vieja", 40);
  folder(base, "reciente", 5);
  folder(base, "protegida", 90);
  fs.writeFileSync(path.join(base, "index.jsonl"), "{}\n");
  const old = new Date(NOW - 90 * DAY);
  fs.utimesSync(path.join(base, "index.jsonl"), old, old);

  const removed = await pruneFolders(base, 30 * DAY, NOW, (name) => name === "protegida");
  assert.deepEqual(removed, ["vieja"]);
  assert.deepEqual(fs.readdirSync(base).sort(), ["index.jsonl", "protegida", "reciente"]);
  fs.rmSync(base, { recursive: true, force: true });
});

test("pruneFolders: una carpeta inexistente no es un error", async () => {
  assert.deepEqual(await pruneFolders(path.join(os.tmpdir(), "no-existe-jarvis-xyz"), DAY, NOW), []);
});

test("runRetention: aplica retentionDays a refs y trazas, protege las refs de tareas retenidas y 0 desactiva", async () => {
  const root = tempDir();
  const refsDir = path.join(root, "refs");
  const traces = path.join(root, "traces");
  folder(refsDir, "task_viva", 60);
  folder(refsDir, "task_vieja", 60);
  folder(refsDir, "task_nueva", 1);
  folder(traces, "20260101-000000_task_vieja", 60);
  folder(traces, "20261108-000000_task_nueva", 1);

  const config = (retentionDays: number) => (): JarvisConfig => ({ refsDir, tracePath: path.join(root, "traces.jsonl"), retentionDays }) as JarvisConfig;

  await runRetention(config(0), () => [], NOW);
  assert.equal(fs.readdirSync(refsDir).length, 3, "0 no borra nada");

  await runRetention(config(30), () => ["task_viva"], NOW);
  assert.deepEqual(fs.readdirSync(refsDir).sort(), ["task_nueva", "task_viva"]);
  assert.deepEqual(fs.readdirSync(traces), ["20261108-000000_task_nueva"]);
  fs.rmSync(root, { recursive: true, force: true });
});
