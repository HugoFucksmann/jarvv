/**
 * Pruebas de `jarvis_files` (`find_files`, `list_folder`, `system_info`):
 * - Árboles de carpetas temporales (`os.tmpdir()`), entorno falso y lector de sistema falso (sin Windows).
 * - Compatibilidad con `readToolResult`, `processResult` (extractor estructurado), `Guard` y el catálogo interno.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { UserEnvironment } from "../src/core/environment.ts";
import { Guard } from "../src/core/policy/guard.ts";
import { processResult } from "../src/core/result/processResult.ts";
import {
  applyDestination,
  buildCompactCatalog,
  getToolPolicy,
  SYSTEM_TOOL_MANIFEST,
  timeoutOf,
} from "../src/core/tools/manifest.ts";
import { readToolResult } from "../src/core/tools/result.ts";
import { FilesReadProvider } from "../src/tools/files_read/filesReadProvider.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix = "jarvis-files-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFileSized(filePath: string, content: string | Buffer, mtimeMs?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  if (mtimeMs !== undefined) {
    const t = new Date(mtimeMs);
    fs.utimesSync(filePath, t, t);
  }
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────── Catálogo y registro interno ─────────────────────────

test("files_read: find_files y list_folder están en el catálogo y los sirve jarvis_files_read", async () => {
  for (const name of ["find_files", "list_folder"]) {
    const def = SYSTEM_TOOL_MANIFEST.find((d) => d.server === "jarvis_files_read" && d.name === name);
    assert.ok(def, `falta ${name} en SYSTEM_TOOL_MANIFEST`);
    assert.equal(def.route, "files_read");
    assert.equal(def.internal, undefined);
    assert.equal(def.policy.mutates, false);
    assert.equal(def.policy.requiresApproval, false);
    assert.equal(getToolPolicy("jarvis_files_read", name).capability, "FILE_READ");
    assert.equal(Guard.evaluate("jarvis_files_read", name, { path: "/tmp/demo" }).decision, "ALLOW");
    assert.ok(buildCompactCatalog().includes(name), `${name} debe figurar en el catálogo de D1/D2`);
  }
  assert.equal(timeoutOf("jarvis_files_read", "find_files"), 15_000);
  assert.equal(timeoutOf("jarvis_files_read", "list_folder"), 10_000);
  const read = await new FilesReadProvider().listTools();
  assert.deepEqual(applyDestination("files_read", read).map((t) => t.name), ["find_files", "list_folder", "search_content", "read_file"]);
});

// ───────────────────────── find_files ─────────────────────────

test("find_files: encuentra carpetas por nombre y prefijo, archivos por *.csv y *.csv|*.json, y respeta comodines literales", async () => {
  const root = makeTempDir();
  fs.mkdirSync(path.join(root, "sub", "jarvv"), { recursive: true });
  fs.mkdirSync(path.join(root, "jarvv_extra"), { recursive: true });
  writeFileSized(path.join(root, "ventas.csv"), "a,b\n1,2\n");
  writeFileSized(path.join(root, "sub", "config.json"), "{}");
  writeFileSized(path.join(root, "sub", "nota(v1).txt"), "hola");
  writeFileSized(path.join(root, "sub", "otro.md"), "# md");

  const provider = new FilesReadProvider({
    environment: async () => ({ platform: "linux", home: root }),
  });

  // Carpeta por nombre y por prefijo (exacta antes que prefijo, sin importar profundidad)
  const dirRes = await provider.callTool("find_files", { pattern: "jarvv", path: root, type: "folder" });
  const dirRead = readToolResult(dirRes);
  assert.ok(dirRead);
  assert.equal(dirRead.data.state, "found");
  assert.equal(dirRead.data.complete, true);
  assert.equal(dirRead.data.count, 2);
  assert.match(dirRead.text, /^status: found · 2 matches · complete/);
  const lines = dirRead.text.split("\n").slice(1);
  assert.ok(lines[0].startsWith("[DIR]  ") && lines[0].endsWith(`${path.sep}jarvv`), "coincidencia exacta primero");
  assert.ok(lines[1].startsWith("[DIR]  ") && lines[1].endsWith(`${path.sep}jarvv_extra`), "prefijo después");

  // Comodín único *.csv
  const csvRes = await provider.callTool("find_files", { pattern: "*.csv", path: root });
  const csvRead = readToolResult(csvRes);
  assert.ok(csvRead);
  assert.equal(csvRead.data.state, "found");
  assert.equal(csvRead.data.count, 1);
  assert.ok(csvRead.text.includes("ventas.csv"));
  assert.equal(csvRead.text.includes("config.json"), false);

  // Varias alternativas *.csv|*.json
  const multiRes = await provider.callTool("find_files", { pattern: "*.csv|*.json", path: root, type: "file" });
  const multiRead = readToolResult(multiRes);
  assert.ok(multiRead);
  assert.equal(multiRead.data.state, "found");
  assert.equal(multiRead.data.count, 2);
  assert.ok(multiRead.text.includes("ventas.csv"));
  assert.ok(multiRead.text.includes("config.json"));

  // Paréntesis literales (no es regex)
  const litRes = await provider.callTool("find_files", { pattern: "*(v1).txt", path: root });
  const litRead = readToolResult(litRes);
  assert.ok(litRead);
  assert.equal(litRead.data.state, "found");
  assert.equal(litRead.data.count, 1);
  assert.ok(litRead.text.includes("nota(v1).txt"));
});

test("find_files: distingue no_results (recorrido completo) de incomplete (cortado por plazo mínimo)", async () => {
  const root = makeTempDir();
  for (let i = 0; i < 120; i++) {
    writeFileSized(path.join(root, `carpeta_${i % 10}`, `archivo_${i}.txt`), "x");
  }

  // Recorrido completo sin coincidencias -> no_results -> processResult: no_data
  const fullProvider = new FilesReadProvider({ environment: async () => ({ platform: "linux", home: root }) });
  const noRes = await fullProvider.callTool("find_files", { pattern: "inexistente_xyz", path: root });
  const noRead = readToolResult(noRes);
  assert.ok(noRead);
  assert.equal(noRead.data.state, "no_results");
  assert.equal(noRead.data.complete, true);
  assert.match(noRead.text, /^status: no_results · searched \d+ entries in .+ · complete$/);
  assert.equal(processResult("jarvis_files", "find_files", noRes, { pattern: "inexistente_xyz" }).status, "no_data");

  // Cortado por plazo mínimo -> incomplete -> processResult: ok (NO es no_data)
  let tick = 1000;
  const timedProvider = new FilesReadProvider({
    environment: async () => ({ platform: "linux", home: root }),
    now: () => (tick += 10),
    findTimeoutMs: 1,
  });
  const incRes = await timedProvider.callTool("find_files", { pattern: "inexistente_xyz", path: root });
  const incRead = readToolResult(incRes);
  assert.ok(incRead);
  assert.equal(incRead.data.state, "incomplete");
  assert.equal(incRead.data.complete, false);
  assert.equal(incRead.data.stoppedBy, "time");
  assert.match(incRead.text, /^status: incomplete · 0 matches · stopped by time: not a "not found"; narrow the path$/);
  assert.equal(processResult("jarvis_files", "find_files", incRes, { pattern: "inexistente_xyz" }).status, "ok");

  // Coincidencias pero cortado por tope de entradas -> partial
  writeFileSized(path.join(root, "archivo_raiz.txt"), "x");
  const partialProvider = new FilesReadProvider({
    environment: async () => ({ platform: "linux", home: root }),
    findMaxEntries: 15,
  });
  const partRes = await partialProvider.callTool("find_files", { pattern: "*.txt", path: root });
  const partRead = readToolResult(partRes);
  assert.ok(partRead);
  assert.equal(partRead.data.state, "partial");
  assert.equal(partRead.data.complete, false);
  assert.equal(partRead.data.stoppedBy, "entries");
  assert.match(partRead.text, /^status: partial · \d+ match/);
  assert.equal(processResult("jarvis_files", "find_files", partRes, { pattern: "*.txt" }).status, "ok");
});

test("find_files: respeta maxResults, lista de exclusión, symlinks fuera de raíz y allowedDirectories", async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-outside-");
  writeFileSized(path.join(root, "a.log"), "1");
  writeFileSized(path.join(root, "b.log"), "2");
  writeFileSized(path.join(root, "c.log"), "3");
  writeFileSized(path.join(root, "node_modules", "pkg", "oculto.log"), "4");
  writeFileSized(path.join(root, ".git", "head.log"), "5");
  writeFileSized(path.join(outside, "externo.log"), "6");

  // Enlace que apunta fuera de `root`: debe omitirse y contarse en `skipped`. En Windows un symlink pide privilegios (EPERM); una unión (junction) no.
  fs.symlinkSync(outside, path.join(root, "enlace_externo"), process.platform === "win32" ? "junction" : "dir");

  const provider = new FilesReadProvider({
    allowedDirectories: () => [root],
    environment: async () => ({ platform: "linux", home: root }),
  });

  // maxResults y lista de exclusión
  const res = await provider.callTool("find_files", { pattern: "*.log", path: root, maxResults: 2 });
  const read = readToolResult(res);
  assert.ok(read);
  assert.equal(read.data.state, "found");
  assert.equal(read.data.count, 2);
  assert.equal(read.data.skipped, 1, "symlink externo omitido");
  assert.equal(read.text.includes("oculto.log"), false, "node_modules excluida");
  assert.equal(read.text.includes("head.log"), false, ".git excluida");
  assert.equal(read.text.includes("externo.log"), false, "symlink fuera de raíz no seguido");

  // Si el usuario nombra explícitamente la carpeta excluida como `path`, sí busca adentro
  const nmRes = await provider.callTool("find_files", {
    pattern: "oculto.log",
    path: path.join(root, "node_modules"),
  });
  const nmRead = readToolResult(nmRes);
  assert.ok(nmRead);
  assert.equal(nmRead.data.state, "found");
  assert.equal(nmRead.data.count, 1);
  assert.ok(nmRead.text.includes("oculto.log"));

  // Fuera de allowedDirectories -> isError + [DENIED] -> processResult: denied
  const deniedRes = await provider.callTool("find_files", { pattern: "*.log", path: outside });
  assert.equal(deniedRes.isError, true);
  assert.equal(processResult("jarvis_files", "find_files", deniedRes, { path: outside }).status, "denied");
});

test("find_files: se corta al instante con la señal de cancelación", async () => {
  const root = makeTempDir();
  for (let i = 0; i < 40; i++) {
    writeFileSized(path.join(root, `f_${i}.txt`), "x");
  }

  const provider = new FilesReadProvider({ environment: async () => ({ platform: "linux", home: root }) });
  const ac = new AbortController();
  ac.abort();

  const started = Date.now();
  const res = await provider.callTool("find_files", { pattern: "*.txt", path: root }, { signal: ac.signal });
  const elapsed = Date.now() - started;

  const read = readToolResult(res);
  assert.ok(read);
  assert.equal(read.data.state, "cancelled");
  assert.equal(read.data.scanned, 0);
  assert.ok(elapsed < 100);
});

// ───────────────────────── list_folder ─────────────────────────

test("list_folder: ordena por tamaño y fecha, filtra por extensión, resuelve desktop y maneja carpeta vacía", async () => {
  const root = makeTempDir();
  const desktop = path.join(root, "EscritorioReal");
  const emptyDir = path.join(root, "Vacia");
  fs.mkdirSync(desktop, { recursive: true });
  fs.mkdirSync(emptyDir, { recursive: true });

  const tOld = Date.UTC(2026, 0, 10, 9, 0);
  const tMid = Date.UTC(2026, 4, 15, 12, 30);
  const tNew = Date.UTC(2026, 10, 18, 14, 2);

  writeFileSized(path.join(desktop, "chico.csv"), "a", tNew);
  writeFileSized(path.join(desktop, "mediano.json"), "a".repeat(2500), tOld);
  writeFileSized(path.join(desktop, "grande.csv"), "a".repeat(12_700), tMid);
  writeFileSized(path.join(desktop, ".oculto.csv"), "secreto", tNew);
  fs.mkdirSync(path.join(desktop, "sub"));
  writeFileSized(path.join(desktop, "sub", "interno.json"), '{"ok":true}', tNew);

  const env: UserEnvironment = { platform: "linux", home: root, desktop };
  const provider = new FilesReadProvider({ environment: async () => env });

  // Alias `desktop`, orden por tamaño desc (por omisión para size) y ocultos fuera
  const bySize = await provider.callTool("list_folder", { path: "desktop", sortBy: "size" });
  const sizeRead = readToolResult(bySize);
  assert.ok(sizeRead);
  assert.equal(sizeRead.data.state, "ok");
  assert.equal(sizeRead.data.total, 4);
  assert.equal(sizeRead.text.includes(".oculto.csv"), false);
  const sizeLines = sizeRead.text.split("\n").slice(1);
  assert.ok(sizeLines[0].includes("grande.csv"));
  assert.ok(sizeLines[1].includes("mediano.json"));
  assert.ok(sizeLines[2].includes("chico.csv"));
  assert.ok(sizeLines[3].startsWith("[DIR]  sub"));
  assert.ok(sizeRead.raw.includes("12700 B"), "raw conserva el tamaño exacto en bytes");
  assert.equal(processResult("jarvis_files", "list_folder", bySize, { path: "desktop" }).status, "ok");

  // Orden por fecha asc y filtro de extensiones con depth=2
  const byDate = await provider.callTool("list_folder", {
    path: "desktop",
    sortBy: "modified",
    order: "asc",
    extensions: ["csv", "json"],
    depth: 2,
  });
  const dateRead = readToolResult(byDate);
  assert.ok(dateRead);
  assert.equal(dateRead.data.total, 4);
  const dateLines = dateRead.text.split("\n").slice(1);
  assert.ok(dateLines[0].includes("mediano.json"), "el más antiguo primero en asc");
  assert.ok(dateLines[1].includes("grande.csv"));
  assert.ok(dateLines.some((l) => l.includes("sub/interno.json")), "con depth > 1 muestra ruta relativa");

  // Carpeta vacía: data.state = "ok", count = 0, no es no_results
  const emptyRes = await provider.callTool("list_folder", { path: emptyDir });
  const emptyRead = readToolResult(emptyRes);
  assert.ok(emptyRead);
  assert.equal(emptyRead.data.state, "ok");
  assert.equal(emptyRead.data.count, 0);
  assert.equal(emptyRead.text, "Folder is empty.");
  assert.equal(processResult("jarvis_files", "list_folder", emptyRes, { path: emptyDir }).status, "ok");

  // Ruta inexistente o archivo -> isError: true
  const missing = await provider.callTool("list_folder", { path: path.join(root, "no_existe") });
  assert.equal(missing.isError, true);
  const onFile = await provider.callTool("list_folder", { path: path.join(desktop, "chico.csv") });
  assert.equal(onFile.isError, true);
});
