/**
 * Pruebas unitarias de `jarvis_files_read` (`read_file`, `search_content`):
 * - Lectura por streaming con `offset`/`limit`, recorte de líneas largas, presupuesto y archivos vacíos.
 * - Rechazo de binarios (bytes NUL) y extensiones estructuradas sin driver + despacho con `ReadFileDriver`.
 * - Búsqueda literal/regex, `filePattern`, `maxResults`, `maxMatchesPerFile`, exclusión de carpetas ruidosas,
 *   protección contra symlinks salientes, `allowedDirectories`, timeout (`incomplete`) y `AbortSignal`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { readToolResult, toolResult } from "../src/core/tools/result.ts";
import { FilesReadProvider, type ReadFileDriver } from "../src/tools/files_read/filesReadProvider.ts";
import { SYMLINKS_SKIP } from "./helpers/symlinks.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix = "jarvis-read-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────── Provider metadata ─────────────────────────

test("jarvis_files_read: lista exactamente las tools del grupo files_read y rechaza tools desconocidas", async () => {
  const provider = new FilesReadProvider();
  assert.equal(provider.name, "jarvis_files_read");
  assert.equal(provider.isConnected(), true);
  const tools = await provider.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["find_files", "list_folder", "search_content", "read_file"],
  );
  const unknown = await provider.callTool("write_file", {});
  assert.equal(unknown.isError, true);
  assert.match(readToolResult(unknown)?.text ?? "", /Unknown tool/);
});

// ───────────────────────── read_file ─────────────────────────

test("read_file: lee rangos con offset/limit, numera líneas, maneja archivo vacío y recorta líneas largas", async () => {
  const root = makeTempDir();
  const emptyFile = path.join(root, "vacio.txt");
  const linesFile = path.join(root, "notas.txt");
  const longLineFile = path.join(root, "largo.txt");

  writeFile(emptyFile, "");
  const allLines = Array.from({ length: 12 }, (_, i) => `linea ${i + 1}: contenido`).join("\n");
  writeFile(linesFile, allLines);
  writeFile(longLineFile, `${"x".repeat(650)}\nsegunda linea`);

  const provider = new FilesReadProvider({
    environment: async () => ({ platform: "linux", home: root }),
  });

  // Archivo vacío
  const emptyRes = await provider.callTool("read_file", { path: emptyFile });
  const emptyRead = readToolResult(emptyRes);
  assert.ok(emptyRead);
  assert.equal(emptyRes.isError, false);
  assert.equal(emptyRead.data.state, "ok");
  assert.equal(emptyRead.data.totalLines, 0);
  assert.ok(emptyRead.text.includes("(file is empty)"));

  // Rango con offset y limit + hasMore
  const sliceRes = await provider.callTool("read_file", { path: linesFile, offset: 4, limit: 3 });
  const sliceRead = readToolResult(sliceRes);
  assert.ok(sliceRead);
  assert.equal(sliceRead.data.state, "ok");
  assert.equal(sliceRead.data.totalLines, 12);
  assert.equal(sliceRead.data.fromLine, 4);
  assert.equal(sliceRead.data.toLine, 6);
  assert.equal(sliceRead.data.hasMore, true);
  assert.ok(sliceRead.text.includes("4 | linea 4: contenido"));
  assert.ok(sliceRead.text.includes("6 | linea 6: contenido"));
  assert.equal(sliceRead.text.includes("linea 7"), false);
  assert.ok(sliceRead.text.includes("pass offset=7 to continue"));

  // Offset fuera de rango
  const oobRes = await provider.callTool("read_file", { path: linesFile, offset: 99 });
  assert.equal(oobRes.isError, true);
  assert.equal(readToolResult(oobRes)?.data.reason, "offset_out_of_range");

  // Línea muy larga: recorta display pero conserva raw completo
  const longRes = await provider.callTool("read_file", { path: longLineFile });
  const longRead = readToolResult(longRes);
  assert.ok(longRead);
  assert.equal(longRead.data.truncated, true);
  assert.ok(longRead.text.includes("(+150 chars)"));
  assert.ok(longRead.raw.includes("x".repeat(650)));
});

test("read_file: rechaza binarios con bytes NUL y extensiones estructuradas sin driver, y despacha drivers registrados", async () => {
  const root = makeTempDir();
  const binFile = path.join(root, "datos.dat");
  const pdfFile = path.join(root, "contrato.pdf");
  const docxFile = path.join(root, "informe.docx");

  writeFile(binFile, Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]));
  writeFile(pdfFile, "%PDF-1.7\nfake-binary");
  writeFile(docxFile, "PK\x03\x04fake-zip");

  const defaultProvider = new FilesReadProvider({
    environment: async () => ({ platform: "linux", home: root }),
  });

  const binRes = await defaultProvider.callTool("read_file", { path: binFile });
  assert.equal(binRes.isError, true);
  assert.equal(readToolResult(binRes)?.data.reason, "binary_file");

  const pdfRes = await defaultProvider.callTool("read_file", { path: pdfFile });
  assert.equal(pdfRes.isError, true);
  assert.equal(readToolResult(pdfRes)?.data.reason, "unsupported_format");
  assert.equal(readToolResult(pdfRes)?.data.extension, "pdf");

  // Con driver personalizado para .pdf
  const pdfDriver: ReadFileDriver = {
    id: "test-pdf-driver",
    extensions: [".pdf"],
    async read(ctx) {
      const msg = `status: ok · pdf driver read ${path.basename(ctx.realTarget)} (offset=${ctx.offset})`;
      return toolResult({ text: msg, raw: msg, data: { state: "ok", format: "pdf", truncated: false } });
    },
  };

  const withDriverProvider = new FilesReadProvider({
    environment: async () => ({ platform: "linux", home: root }),
    readDrivers: [pdfDriver],
  });

  const pdfOk = await withDriverProvider.callTool("read_file", { path: pdfFile, offset: 2 });
  assert.equal(pdfOk.isError, false);
  assert.ok(readToolResult(pdfOk)?.text.includes("pdf driver read contrato.pdf (offset=2)"));

  // .docx sigue rechazado si solo se registró .pdf
  const docxStillErr = await withDriverProvider.callTool("read_file", { path: docxFile });
  assert.equal(docxStillErr.isError, true);
  assert.equal(readToolResult(docxStillErr)?.data.reason, "unsupported_format");
});

test("read_file: valida allowedDirectories, symlinks que escapan, argumentos inválidos y AbortSignal", { skip: SYMLINKS_SKIP }, async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-outside-read-");
  const insideFile = path.join(root, "ok.txt");
  const outsideFile = path.join(outside, "secreto.txt");
  const linkPath = path.join(root, "escape.txt");

  writeFile(insideFile, "hola\nmundo");
  writeFile(outsideFile, "no-leer");
  fs.symlinkSync(outsideFile, linkPath);

  const provider = new FilesReadProvider({
    allowedDirectories: () => [root],
    environment: async () => ({ platform: "linux", home: root }),
  });

  // Ruta externa
  const outRes = await provider.callTool("read_file", { path: outsideFile });
  assert.equal(outRes.isError, true);
  assert.equal(readToolResult(outRes)?.data.reason, "denied");

  // Symlink hacia afuera
  const linkRes = await provider.callTool("read_file", { path: linkPath });
  assert.equal(linkRes.isError, true);
  assert.equal(readToolResult(linkRes)?.data.reason, "denied");

  // Carpeta en vez de archivo
  const dirRes = await provider.callTool("read_file", { path: root });
  assert.equal(dirRes.isError, true);

  // Argumentos inválidos
  assert.equal((await provider.callTool("read_file", { path: insideFile, offset: 0 })).isError, true);
  assert.equal((await provider.callTool("read_file", { path: insideFile, encoding: "utf16le" })).isError, true);

  // Cancelación inmediata
  const ac = new AbortController();
  ac.abort();
  const cancelled = await provider.callTool("read_file", { path: insideFile }, { signal: ac.signal });
  assert.equal(readToolResult(cancelled)?.data.state, "cancelled");
});

// ───────────────────────── search_content ─────────────────────────

test("search_content: busca literal y regex, filtra filePattern, respeta límites y busca en archivo puntual", async () => {
  const root = makeTempDir();
  writeFile(path.join(root, "src", "app.ts"), "const TOKEN = 'abc';\nconst second = 'TOKEN';\nconst third = 'Token';");
  writeFile(path.join(root, "src", "other.ts"), "export const token = 42;\nexport const x = 1;");
  writeFile(path.join(root, "README.md"), "Documentacion sobre token y mas texto.");
  writeFile(path.join(root, ".oculto.ts"), "token secreto oculto");
  writeFile(path.join(root, "node_modules", "pkg", "index.ts"), "token en dependencia");
  writeFile(path.join(root, "binario.bin"), Buffer.from([0x74, 0x6f, 0x6b, 0x00, 0x65, 0x6e]));

  const provider = new FilesReadProvider({
    environment: async () => ({ platform: "linux", home: root }),
  });

  // Búsqueda literal insensible a mayúsculas filtrada por *.ts
  const tsRes = await provider.callTool("search_content", {
    query: "token",
    path: root,
    filePattern: "*.ts",
  });
  const tsRead = readToolResult(tsRes);
  assert.ok(tsRead);
  assert.equal(tsRead.data.state, "found");
  assert.equal(tsRead.data.complete, true);
  assert.equal(tsRead.data.count, 4); // 3 en app.ts + 1 en other.ts (.oculto y node_modules excluidos)
  assert.equal(tsRead.text.includes("README.md"), false);
  assert.equal(tsRead.text.includes("node_modules"), false);
  assert.equal(tsRead.text.includes(".oculto.ts"), false);

  // Case sensitive + maxMatchesPerFile
  const csRes = await provider.callTool("search_content", {
    query: "TOKEN",
    path: root,
    filePattern: "*.ts",
    caseSensitive: true,
    maxMatchesPerFile: 1,
  });
  const csRead = readToolResult(csRes);
  assert.ok(csRead);
  assert.equal(csRead.data.count, 1);

  // Regex + includeHidden
  const rxRes = await provider.callTool("search_content", {
    query: "secreto\\s+oculto$",
    path: root,
    regex: true,
    includeHidden: true,
  });
  const rxRead = readToolResult(rxRes);
  assert.ok(rxRead);
  assert.equal(rxRead.data.count, 1);
  assert.ok(rxRead.text.includes(".oculto.ts"));

  // Archivo individual como target
  const singleRes = await provider.callTool("search_content", {
    query: "Documentacion",
    path: path.join(root, "README.md"),
  });
  assert.equal(readToolResult(singleRes)?.data.count, 1);

  // Sin resultados completos -> no_results
  const noneRes = await provider.callTool("search_content", { query: "XYZ_INEXISTENTE", path: root });
  assert.equal(readToolResult(noneRes)?.data.state, "no_results");
  assert.equal(readToolResult(noneRes)?.data.complete, true);
});

test("search_content: omite archivos grandes, symlinks salientes, corta por maxResults/tiempo y respeta AbortSignal", { skip: SYMLINKS_SKIP }, async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-search-out-");
  writeFile(path.join(root, "a.txt"), "clave\nclave\nclave");
  writeFile(path.join(root, "grande.txt"), "clave ".repeat(500));
  writeFile(path.join(outside, "externo.txt"), "clave externa");
  fs.symlinkSync(outside, path.join(root, "link_externo"), "dir");

  const provider = new FilesReadProvider({
    allowedDirectories: () => [root],
    environment: async () => ({ platform: "linux", home: root }),
    searchMaxFileBytes: 200,
  });

  const fullSkipRes = await provider.callTool("search_content", {
    query: "clave",
    path: root,
    maxResults: 10,
  });
  const fullSkipRead = readToolResult(fullSkipRes);
  assert.ok(fullSkipRead);
  assert.equal(fullSkipRead.data.state, "found");
  assert.equal(fullSkipRead.data.count, 3);
  assert.equal(fullSkipRead.data.skippedLarge, 1);
  assert.equal(fullSkipRead.data.skipped, 1);
  assert.equal(fullSkipRead.text.includes("externo.txt"), false);

  const limitedRes = await provider.callTool("search_content", {
    query: "clave",
    path: root,
    maxResults: 2,
  });
  const limitedRead = readToolResult(limitedRes);
  assert.ok(limitedRead);
  assert.equal(limitedRead.data.state, "partial");
  assert.equal(limitedRead.data.stoppedBy, "limit");
  assert.equal(limitedRead.data.count, 2);

  // Tiempo agotado sin hallazgos -> incomplete
  let tick = 100;
  const timedProvider = new FilesReadProvider({
    environment: async () => ({ platform: "linux", home: root }),
    now: () => (tick += 50),
    searchTimeoutMs: 1,
  });
  const incRes = await timedProvider.callTool("search_content", { query: "nada_aqui", path: root });
  const incRead = readToolResult(incRes);
  assert.ok(incRead);
  assert.equal(incRead.data.state, "incomplete");
  assert.equal(incRead.data.stoppedBy, "time");

  // Allowed directories denegado
  const denied = await provider.callTool("search_content", { query: "clave", path: outside });
  assert.equal(denied.isError, true);
  assert.equal(readToolResult(denied)?.data.reason, "denied");

  // Regex inválido
  const badRegex = await provider.callTool("search_content", { query: "[sin_cerrar", path: root, regex: true });
  assert.equal(badRegex.isError, true);

  // AbortSignal
  const ac = new AbortController();
  ac.abort();
  const cancelled = await provider.callTool("search_content", { query: "clave", path: root }, { signal: ac.signal });
  assert.equal(readToolResult(cancelled)?.data.state, "cancelled");
});

test("regresiones files_read: abortar a mitad de stream en read_file y search_content cierra limpiamente sin errores no capturados", async () => {
  const root = makeTempDir();
  const bigTextFile = path.join(root, "stream_largo.txt");
  const line = "linea de prueba para streaming seguro en nodejs 0123456789abcdef\n";
  writeFile(bigTextFile, line.repeat(120_000));

  const provider = new FilesReadProvider({
    allowedDirectories: () => [root],
    environment: async () => ({ platform: "linux", home: root }),
  });

  const acRead = new AbortController();
  setTimeout(() => acRead.abort(), 2);
  const readAbortRes = await provider.callTool("read_file", { path: bigTextFile, limit: 2000 }, { signal: acRead.signal });
  assert.equal(readAbortRes.isError, false);
  const readAbortState = readToolResult(readAbortRes)?.data.state;
  assert.ok(readAbortState === "cancelled" || readAbortState === "ok");

  const acSearch = new AbortController();
  setTimeout(() => acSearch.abort(), 2);
  const searchAbortRes = await provider.callTool(
    "search_content",
    { query: "cadena_inexistente_en_el_stream", path: bigTextFile, maxResults: 200 },
    { signal: acSearch.signal },
  );
  assert.equal(searchAbortRes.isError, false);
  const searchAbortState = readToolResult(searchAbortRes)?.data.state;
  assert.ok(searchAbortState === "cancelled" || searchAbortState === "no_results");
});

