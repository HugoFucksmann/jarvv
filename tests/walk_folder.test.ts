/**
 * Recorrido compartido de carpetas (`core/tools/walkFolder.ts`): orden por anchura, topes, enlaces que salen de la raíz, carpetas excluidas, archivos ocultos y cancelación.
 * Árboles temporales en `os.tmpdir()`; en Windows el enlace de prueba es una unión (no pide privilegios).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { settle, walkFolder, type WalkEntry, type WalkOptions } from "../src/core/tools/walkFolder.ts";

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tree(files: readonly string[]): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-walk-")));
  tempDirs.push(root);
  for (const rel of files) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (!rel.endsWith("/")) fs.writeFileSync(full, "x".repeat(rel.length));
  }
  return root;
}

function options(root: string, over: Partial<WalkOptions> = {}): WalkOptions {
  return { root, realRoot: root, maxDepth: 10, deadline: Number.POSITIVE_INFINITY, now: () => 0, ...over };
}

async function collect(opts: WalkOptions) {
  const walk = walkFolder(opts);
  const entries: WalkEntry[] = [];
  for await (const entry of walk.entries) entries.push(entry);
  return { entries, state: walk.state };
}

const names = (entries: readonly WalkEntry[]): string[] => entries.map((e) => e.name);

test("recorre en anchura: primero lo de la raíz, luego lo de cada subcarpeta, con su profundidad", async () => {
  const root = tree(["a.txt", "d1/b.txt", "d1/d2/c.txt", "d3/e.txt"]);
  const { entries, state } = await collect(options(root));
  const byDepth = entries.map((e) => e.depth);
  assert.deepEqual(byDepth, [...byDepth].sort((x, y) => x - y), "las profundidades no decrecen (BFS)");
  assert.deepEqual(new Set(names(entries)), new Set(["a.txt", "d1", "d3", "b.txt", "d2", "e.txt", "c.txt"]));
  assert.equal(state.seen, 7);
  assert.equal(state.stoppedBy, undefined);
  assert.equal(state.cancelled, false);
  assert.equal(state.hitDepthLimit, false);
});

test("maxDepth: lo de más abajo no se recorre y queda marcado", async () => {
  const root = tree(["a.txt", "d1/b.txt", "d1/d2/c.txt"]);
  const { entries, state } = await collect(options(root, { maxDepth: 2 }));
  assert.ok(!names(entries).includes("c.txt"));
  assert.ok(names(entries).includes("b.txt"));
  assert.equal(state.hitDepthLimit, true);
});

test("maxEntries corta con stoppedBy 'entries' y deja de entregar", async () => {
  const root = tree(["1.txt", "2.txt", "3.txt", "4.txt", "5.txt"]);
  const { entries, state } = await collect(options(root, { maxEntries: 3 }));
  assert.equal(entries.length, 3);
  assert.equal(state.seen, 3);
  assert.equal(state.stoppedBy, "entries");
});

test("el plazo corta con stoppedBy 'time'", async () => {
  const root = tree(["1.txt", "2.txt", "3.txt"]);
  let tick = 0;
  const { entries, state } = await collect(options(root, { deadline: 3, now: () => tick++ }));
  assert.ok(entries.length < 3, "no llegó a entregar todo");
  assert.equal(state.stoppedBy, "time");
});

test("cancelar antes de empezar o durante el recorrido: cancelled y sin más entradas", async () => {
  const root = tree(["1.txt", "2.txt", "3.txt"]);
  const before = new AbortController();
  before.abort();
  const early = await collect(options(root, { signal: before.signal }));
  assert.equal(early.entries.length, 0);
  assert.equal(early.state.cancelled, true);

  const during = new AbortController();
  const walk = walkFolder(options(root, { signal: during.signal }));
  let seen = 0;
  for await (const _entry of walk.entries) {
    if (++seen === 1) during.abort();
  }
  assert.equal(walk.state.cancelled, true);
  assert.ok(seen < 3);
});

test("las carpetas excluidas no se entregan ni se recorren; las ocultas se entregan salvo includeHidden: false", async () => {
  const root = tree(["node_modules/x.js", ".git/config", "src/a.ts", ".env", "visible.txt"]);
  const all = await collect(options(root));
  assert.ok(!names(all.entries).includes("node_modules") && !names(all.entries).includes("x.js"));
  assert.ok(!names(all.entries).includes(".git") && !names(all.entries).includes("config"));
  assert.ok(names(all.entries).includes(".env"), "los ocultos se entregan por defecto");

  const noHidden = await collect(options(root, { includeHidden: false }));
  assert.ok(!names(noHidden.entries).includes(".env"));
  assert.ok(names(noHidden.entries).includes("visible.txt"));
});

test("tamaño: solo si se pide (statFiles); las carpetas valen 0", async () => {
  const root = tree(["dir/a.txt"]);
  const lazy = await collect(options(root));
  assert.equal(lazy.entries.find((e) => e.name === "a.txt")?.size, undefined);
  assert.equal(lazy.entries.find((e) => e.name === "dir")?.size, 0);

  const eager = await collect(options(root, { statFiles: true }));
  assert.equal(eager.entries.find((e) => e.name === "a.txt")?.size, "dir/a.txt".length);
});

test("un enlace que apunta fuera de la raíz se omite (skipped); uno que apunta adentro se recorre una sola vez", async () => {
  const outside = tree(["fuera.txt"]);
  const root = tree(["real/dentro.txt"]);
  const kind = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(outside, path.join(root, "enlace_externo"), kind);
  fs.symlinkSync(path.join(root, "real"), path.join(root, "enlace_interno"), kind);

  const { entries, state } = await collect(options(root));
  assert.ok(!names(entries).includes("fuera.txt"), "no se sigue el enlace externo");
  assert.ok(!names(entries).includes("enlace_externo"));
  assert.equal(state.skipped, 1);
  const inside = entries.filter((e) => e.name === "dentro.txt");
  assert.equal(inside.length, 1, "la carpeta enlazada y la real son la misma: se visita una vez");
});

test("una carpeta ilegible o inexistente cuenta en skipped y no falla", async () => {
  const root = tree(["a.txt"]);
  const { entries, state } = await collect(options(path.join(root, "no-existe"), { realRoot: root }));
  assert.equal(entries.length, 0);
  assert.equal(state.skipped, 1);
});

test("settle: ok, falló o cancelada", async () => {
  assert.deepEqual(await settle(Promise.resolve(5)), { status: "ok", value: 5 });
  assert.deepEqual(await settle(Promise.reject(new Error("x"))), { status: "failed" });
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await settle(Promise.resolve(1), aborted.signal), { status: "aborted" });
});
