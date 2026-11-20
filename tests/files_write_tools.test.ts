/**
 * Pruebas unitarias de `jarvis_files_write`
 * (`create_folder`, `write_file`, `edit_file`, `copy_file`, `move_file`, `delete_file`):
 * - Árboles temporales en `os.tmpdir()` con drivers inyectables (`TrashHandler`, `WriteFileDriver`).
 * - Seguridad: `allowedDirectories`, protección de raíces del usuario/sistema, prevención de
 *   autocopia/automovimiento y symlinks que apuntan fuera (sin seguirlos al borrar).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { UserEnvironment } from "../src/core/environment.ts";
import { readToolResult } from "../src/core/tools/result.ts";
import {
  FilesWriteProvider,
  type ConvertDriver,
  type ConvertRequest,
  type TrashHandler,
  type WriteFileDriver,
} from "../src/tools/files_write/filesWriteProvider.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix = "jarvis-write-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeEnv(home: string): UserEnvironment {
  return {
    platform: "linux",
    home,
    desktop: path.join(home, "Desktop"),
    documents: path.join(home, "Documents"),
    downloads: path.join(home, "Downloads"),
  };
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────── Provider metadata ─────────────────────────

test("jarvis_files_write: lista las 8 tools de escritura y rechaza desconocidas", async () => {
  const provider = new FilesWriteProvider();
  assert.equal(provider.name, "jarvis_files_write");
  assert.equal(provider.isConnected(), true);
  const tools = await provider.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["create_folder", "write_file", "edit_file", "copy_file", "move_file", "delete_file", "archive_files", "convert_file"],
  );
  const unknown = await provider.callTool("read_file", {});
  assert.equal(unknown.isError, true);
});

// ───────────────────────── create_folder ─────────────────────────

test("create_folder: crea carpetas anidadas, es idempotente y rechaza colisión con archivo o fuera de allowedDirectories", async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-write-out-");
  const existingFile = path.join(root, "archivo.txt");
  fs.writeFileSync(existingFile, "hola");

  const provider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => makeEnv(root),
  });

  const nested = path.join(root, "a", "b", "c");
  const res1 = await provider.callTool("create_folder", { path: nested });
  const r1 = readToolResult(res1);
  assert.ok(r1);
  assert.equal(res1.isError, false);
  assert.equal(r1.data.created, true);
  assert.equal(r1.data.alreadyExisted, false);
  assert.equal(fs.statSync(nested).isDirectory(), true);

  // Idempotencia
  const res2 = await provider.callTool("create_folder", { path: nested });
  const r2 = readToolResult(res2);
  assert.ok(r2);
  assert.equal(res2.isError, false);
  assert.equal(r2.data.created, false);
  assert.equal(r2.data.alreadyExisted, true);

  // Colisión sobre un archivo existente
  const overFile = await provider.callTool("create_folder", { path: existingFile });
  assert.equal(overFile.isError, true);
  assert.equal(readToolResult(overFile)?.data.reason, "path_is_file");

  // Fuera de allowedDirectories
  const denied = await provider.callTool("create_folder", { path: path.join(outside, "prohibida") });
  assert.equal(denied.isError, true);
  assert.equal(readToolResult(denied)?.data.reason, "denied");
});

// ───────────────────────── write_file ─────────────────────────

test("write_file: soporta create_only, rewrite, append, createFolders, driver por formato y resguardos de seguridad", async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-writefile-out-");
  const outsideFile = path.join(outside, "ext.txt");
  fs.writeFileSync(outsideFile, "original-externo");
  const escapeLink = path.join(root, "link_ext.txt");
  fs.symlinkSync(outsideFile, escapeLink);

  const provider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => makeEnv(root),
  });

  const target = path.join(root, "sub", "nota.txt");

  // Sin padre y createFolders=false -> error
  const noParent = await provider.callTool("write_file", { path: target, content: "hola" });
  assert.equal(noParent.isError, true);

  // create_only + createFolders: true
  const created = await provider.callTool("write_file", {
    path: target,
    content: "linea 1\n",
    mode: "create_only",
    createFolders: true,
  });
  assert.equal(created.isError, false);
  assert.equal(readToolResult(created)?.data.created, true);

  // create_only repetido -> already_exists
  const dup = await provider.callTool("write_file", { path: target, content: "x", mode: "create_only" });
  assert.equal(dup.isError, true);
  assert.equal(readToolResult(dup)?.data.reason, "already_exists");

  // append
  const appended = await provider.callTool("write_file", { path: target, content: "linea 2\n", mode: "append" });
  assert.equal(appended.isError, false);
  assert.equal(fs.readFileSync(target, "utf8"), "linea 1\nlinea 2\n");

  // rewrite
  const rewrote = await provider.callTool("write_file", { path: target, content: "reemplazado", mode: "rewrite" });
  assert.equal(rewrote.isError, false);
  assert.equal(fs.readFileSync(target, "utf8"), "reemplazado");

  // Symlink que apunta fuera de allowedDirectories -> denied y no toca destino externo
  const linkWrite = await provider.callTool("write_file", { path: escapeLink, content: "pisado" });
  assert.equal(linkWrite.isError, true);
  assert.equal(readToolResult(linkWrite)?.data.reason, "denied");
  assert.equal(fs.readFileSync(outsideFile, "utf8"), "original-externo");

  // Extensión estructurada sin driver -> unsupported_format
  const pdfNoDriver = await provider.callTool("write_file", { path: path.join(root, "doc.pdf"), content: "hola" });
  assert.equal(pdfNoDriver.isError, true);
  assert.equal(readToolResult(pdfNoDriver)?.data.reason, "unsupported_format");

  // Con driver registrado para .docx
  const docxDriver: WriteFileDriver = {
    id: "test-docx-writer",
    extensions: ["docx"],
    async write(ctx) {
      fs.writeFileSync(ctx.targetPath, `DOCX:${ctx.content}`);
      return { content: [{ type: "text", text: `status: ok · driver wrote ${ctx.targetPath}` }], isError: false };
    },
  };
  const withDriver = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => makeEnv(root),
    writeDrivers: [docxDriver],
  });
  const docxRes = await withDriver.callTool("write_file", { path: path.join(root, "informe.docx"), content: "hola" });
  assert.equal(docxRes.isError, false);
  assert.equal(fs.readFileSync(path.join(root, "informe.docx"), "utf8"), "DOCX:hola");
});

// ───────────────────────── edit_file ─────────────────────────

test("edit_file: edita coincidencia única, exige desambiguación si hay múltiples, soporta replaceAll/expectedReplacements y detecta CRLF/binario", async () => {
  const root = makeTempDir();
  const codeFile = path.join(root, "config.ts");
  const crlfFile = path.join(root, "win.txt");
  const binFile = path.join(root, "img.dat");
  const bigFile = path.join(root, "huge.txt");

  fs.writeFileSync(codeFile, "const port = 3000;\nconst label = 'dev';\nconst env = 'dev';\n");
  fs.writeFileSync(crlfFile, "uno\r\ndos\r\ntres\r\n");
  fs.writeFileSync(binFile, Buffer.from([0x41, 0x00, 0x42]));
  fs.writeFileSync(bigFile, "a".repeat(200));

  const provider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => makeEnv(root),
    editMaxFileBytes: 100,
  });

  // Edición única
  const ok1 = await provider.callTool("edit_file", {
    path: codeFile,
    oldText: "const port = 3000;",
    newText: "const port = 8080;",
  });
  assert.equal(ok1.isError, false);
  assert.equal(readToolResult(ok1)?.data.replacements, 1);

  // Ambiguo (2 ocurrencias de 'dev') sin replaceAll ni expectedReplacements
  const ambig = await provider.callTool("edit_file", {
    path: codeFile,
    oldText: "'dev'",
    newText: "'prod'",
  });
  assert.equal(ambig.isError, true);
  assert.equal(readToolResult(ambig)?.data.reason, "ambiguous_match");
  assert.deepEqual(readToolResult(ambig)?.data.lines, [2, 3]);

  // expectedReplacements inconsistente
  const mismatch = await provider.callTool("edit_file", {
    path: codeFile,
    oldText: "'dev'",
    newText: "'prod'",
    expectedReplacements: 3,
  });
  assert.equal(mismatch.isError, true);
  assert.equal(readToolResult(mismatch)?.data.reason, "count_mismatch");

  // replaceAll: true
  const okAll = await provider.callTool("edit_file", {
    path: codeFile,
    oldText: "'dev'",
    newText: "'prod'",
    replaceAll: true,
  });
  assert.equal(okAll.isError, false);
  assert.equal(readToolResult(okAll)?.data.replacements, 2);
  assert.equal(fs.readFileSync(codeFile, "utf8"), "const port = 8080;\nconst label = 'prod';\nconst env = 'prod';\n");

  // Aviso de CRLF cuando pasan LF
  const crlfMiss = await provider.callTool("edit_file", {
    path: crlfFile,
    oldText: "uno\ndos",
    newText: "uno\nDOS",
  });
  assert.equal(crlfMiss.isError, true);
  assert.equal(readToolResult(crlfMiss)?.data.reason, "not_matched");
  assert.ok(readToolResult(crlfMiss)?.text.includes("CRLF/LF"));

  // Binario y tamaño máximo
  const binErr = await provider.callTool("edit_file", { path: binFile, oldText: "A", newText: "B" });
  assert.equal(readToolResult(binErr)?.data.reason, "binary_file");

  const bigErr = await provider.callTool("edit_file", { path: bigFile, oldText: "aaa", newText: "bbb" });
  assert.equal(readToolResult(bigErr)?.data.reason, "file_too_large");
});

// ───────────────────────── copy_file ─────────────────────────

test("copy_file: copia archivo y árbol recursivo, impide autocopia y symlinks salientes, y respeta límites/overwrite", async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-copy-out-");
  const srcFile = path.join(root, "orig.txt");
  const dstFile = path.join(root, "copia.txt");
  fs.writeFileSync(srcFile, "contenido-1");

  const srcDir = path.join(root, "proyecto");
  fs.mkdirSync(path.join(srcDir, "sub"), { recursive: true });
  fs.writeFileSync(path.join(srcDir, "a.txt"), "aaa");
  fs.writeFileSync(path.join(srcDir, "sub", "b.txt"), "bbb");

  const provider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => makeEnv(root),
  });

  // Copia archivo + overwrite false/true
  const c1 = await provider.callTool("copy_file", { source: srcFile, destination: dstFile });
  assert.equal(c1.isError, false);
  assert.equal(fs.readFileSync(dstFile, "utf8"), "contenido-1");

  fs.writeFileSync(srcFile, "contenido-2");
  const cNoOver = await provider.callTool("copy_file", { source: srcFile, destination: dstFile });
  assert.equal(cNoOver.isError, true);
  assert.equal(readToolResult(cNoOver)?.data.reason, "already_exists");

  const cOver = await provider.callTool("copy_file", { source: srcFile, destination: dstFile, overwrite: true });
  assert.equal(cOver.isError, false);
  assert.equal(fs.readFileSync(dstFile, "utf8"), "contenido-2");

  // Copia carpeta recursiva
  const dstDir = path.join(root, "proyecto_backup");
  const cDir = await provider.callTool("copy_file", { source: srcDir, destination: dstDir });
  assert.equal(cDir.isError, false);
  assert.equal(readToolResult(cDir)?.data.filesCopied, 2);
  assert.equal(fs.readFileSync(path.join(dstDir, "sub", "b.txt"), "utf8"), "bbb");

  // Autocopia dentro de subcarpeta rechazada
  const selfCopy = await provider.callTool("copy_file", {
    source: srcDir,
    destination: path.join(srcDir, "sub", "dentro"),
  });
  assert.equal(selfCopy.isError, true);
  assert.equal(readToolResult(selfCopy)?.data.reason, "self_copy");

  // Symlink dentro de srcDir apuntando fuera debe rechazarse
  fs.writeFileSync(path.join(outside, "ext.txt"), "secreto");
  fs.symlinkSync(path.join(outside, "ext.txt"), path.join(srcDir, "link_ext.txt"));
  const escapeCopy = await provider.callTool("copy_file", {
    source: srcDir,
    destination: path.join(root, "proyecto_escape"),
  });
  assert.equal(escapeCopy.isError, true);
  assert.equal(readToolResult(escapeCopy)?.data.reason, "denied");

  // Límite de bytes en copyMaxBytes
  const strictProvider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => makeEnv(root),
    copyMaxBytes: 4,
  });
  const tooBig = await strictProvider.callTool("copy_file", {
    source: srcFile,
    destination: path.join(root, "muy_grande.txt"),
  });
  assert.equal(tooBig.isError, true);
});

// ───────────────────────── move_file ─────────────────────────

test("move_file: mueve en lote con resultado parcial, impide mover raíces protegidas ni carpeta dentro de sí misma", async () => {
  const root = makeTempDir();
  const env = makeEnv(root);
  fs.mkdirSync(env.desktop!, { recursive: true });
  const a = path.join(root, "a.txt");
  const b = path.join(root, "b.txt");
  const destDir = path.join(root, "destino");
  fs.mkdirSync(destDir);
  fs.writeFileSync(a, "uno");
  fs.writeFileSync(b, "dos");

  const subTree = path.join(root, "arbol");
  fs.mkdirSync(path.join(subTree, "hijo"), { recursive: true });

  const provider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => env,
  });

  // Lote mixto: un movimiento válido + uno sobre ruta protegida (desktop) + autocontenido
  const batchRes = await provider.callTool("move_file", {
    items: [
      { source: a, destination: path.join(destDir, "a_renombrado.txt") },
      { source: env.desktop!, destination: path.join(destDir, "Desktop") },
      { source: subTree, destination: path.join(subTree, "hijo", "ciclo") },
    ],
  });
  const batchRead = readToolResult(batchRes);
  assert.ok(batchRead);
  assert.equal(batchRes.isError, false); // parcial: 1 movido de 3
  assert.equal(batchRead.data.state, "partial");
  assert.equal(batchRead.data.moved, 1);
  assert.equal(batchRead.data.failed, 2);
  assert.equal(fs.existsSync(a), false);
  assert.equal(fs.readFileSync(path.join(destDir, "a_renombrado.txt"), "utf8"), "uno");
  assert.equal(fs.existsSync(env.desktop!), true);

  // Overwrite=false vs overwrite=true
  const existingTarget = path.join(destDir, "a_renombrado.txt");
  const conflict = await provider.callTool("move_file", {
    items: [{ source: b, destination: existingTarget }],
  });
  assert.equal(conflict.isError, true);
  assert.equal(fs.existsSync(b), true);

  const replaced = await provider.callTool("move_file", {
    items: [{ source: b, destination: existingTarget }],
    overwrite: true,
  });
  assert.equal(replaced.isError, false);
  assert.equal(fs.readFileSync(existingTarget, "utf8"), "dos");
});

// ───────────────────────── delete_file ─────────────────────────

test("delete_file: envía a papelera por defecto, borra permanente, protege carpetas raíz y no sigue symlinks", async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-del-out-");
  const env = makeEnv(root);
  fs.mkdirSync(env.downloads!, { recursive: true });

  const trashTarget = path.join(root, "papelera.txt");
  const permFile = path.join(root, "permanente.txt");
  const nonEmptyDir = path.join(root, "carpeta_llena");
  const outsideTarget = path.join(outside, "intocable.txt");
  const linkInside = path.join(root, "enlace_a_externo.txt");

  fs.writeFileSync(trashTarget, "trash");
  fs.writeFileSync(permFile, "perm");
  fs.mkdirSync(nonEmptyDir);
  fs.writeFileSync(path.join(nonEmptyDir, "item.txt"), "x");
  fs.writeFileSync(outsideTarget, "sigue-aqui");
  fs.symlinkSync(outsideTarget, linkInside);

  const trashed: string[] = [];
  const fakeTrash: TrashHandler = async ({ targetPath }) => {
    trashed.push(targetPath);
    fs.rmSync(targetPath, { recursive: true, force: true });
  };

  const provider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => env,
    trashHandler: fakeTrash,
  });

  // Papelera por defecto
  const trashRes = await provider.callTool("delete_file", { path: trashTarget });
  assert.equal(trashRes.isError, false);
  assert.equal(readToolResult(trashRes)?.data.mode, "trash");
  assert.deepEqual(trashed, [trashTarget]);
  assert.equal(fs.existsSync(trashTarget), false);

  // Borrado permanente
  const permRes = await provider.callTool("delete_file", { path: permFile, permanent: true });
  assert.equal(permRes.isError, false);
  assert.equal(readToolResult(permRes)?.data.mode, "permanent");
  assert.equal(fs.existsSync(permFile), false);

  // Carpeta no vacía exige recursive: true
  const needRec = await provider.callTool("delete_file", { path: nonEmptyDir, permanent: true });
  assert.equal(needRec.isError, true);
  assert.equal(readToolResult(needRec)?.data.reason, "directory_not_empty");

  const recOk = await provider.callTool("delete_file", { path: nonEmptyDir, recursive: true, permanent: true });
  assert.equal(recOk.isError, false);
  assert.equal(fs.existsSync(nonEmptyDir), false);

  // Nunca borra carpeta raíz del usuario (`downloads`, `home`, etc.)
  const rootDenied = await provider.callTool("delete_file", { path: "downloads", recursive: true, permanent: true });
  assert.equal(rootDenied.isError, true);
  assert.equal(readToolResult(rootDenied)?.data.reason, "denied");
  assert.equal(fs.existsSync(env.downloads!), true);

  // Enlace dentro de allowedDirectories que apunta a un destino permitido: borra solo el enlace
  const insideTarget = path.join(root, "destino_interno.txt");
  const insideLink = path.join(root, "enlace_interno.txt");
  fs.writeFileSync(insideTarget, "intacto");
  fs.symlinkSync(insideTarget, insideLink);
  const insideLinkDel = await provider.callTool("delete_file", { path: insideLink });
  assert.equal(insideLinkDel.isError, false);
  assert.equal(readToolResult(insideLinkDel)?.data.kind, "symlink");
  assert.equal(fs.existsSync(insideLink), false);
  assert.equal(fs.readFileSync(insideTarget, "utf8"), "intacto");

  // Enlace dentro de root que apunta fuera de allowedDirectories -> denied y no borra ninguno
  const linkDenied = await provider.callTool("delete_file", { path: linkInside });
  assert.equal(linkDenied.isError, true);
  assert.equal(readToolResult(linkDenied)?.data.reason, "denied");
  assert.equal(fs.existsSync(linkInside), true);
  assert.equal(fs.readFileSync(outsideTarget, "utf8"), "sigue-aqui");

  // Sin allowedDirectories: borrar el symlink quita solo el enlace y deja intacto el archivo externo
  const unrestrictedProvider = new FilesWriteProvider({
    allowedDirectories: () => [],
    environment: async () => env,
    trashHandler: fakeTrash,
  });
  const linkDel = await unrestrictedProvider.callTool("delete_file", { path: linkInside });
  assert.equal(linkDel.isError, false);
  assert.equal(readToolResult(linkDel)?.data.kind, "symlink");
  assert.equal(fs.existsSync(linkInside), false);
  assert.equal(fs.readFileSync(outsideTarget, "utf8"), "sigue-aqui");

  // En plataforma no-Windows sin papelera y permanent: false, debe fallar explícitamente
  const noTrashTarget = path.join(root, "otro.txt");
  fs.writeFileSync(noTrashTarget, "hola");
  const linuxProvider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => env,
    platform: "linux",
  });
  const noTrashErr = await linuxProvider.callTool("delete_file", { path: noTrashTarget });
  assert.equal(noTrashErr.isError, true);
  assert.equal(fs.existsSync(noTrashTarget), true);
});

// ───────────────────────── archive_files ─────────────────────────

function buildRawZipWithEntry(entryName: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(entryName, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8); // Store
  local.writeUInt32LE(0, 14); // CRC dummy (no llegará a verificarse ante Zip Slip)
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(0, 10);
  cd.writeUInt32LE(0, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(0, 42);

  const cdOffset = local.length + nameBuf.length + data.length;
  const cdSize = cd.length + nameBuf.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([local, nameBuf, data, cd, nameBuf, eocd]);
}

test("archive_files: comprime y extrae .zip, bloquea Zip Slip, symlinks salientes y exceso de tamaño", async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-zip-out-");
  const env = makeEnv(root);

  const srcDir = path.join(root, "paquete");
  fs.mkdirSync(path.join(srcDir, "sub"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "node_modules", "ignored"), { recursive: true });
  fs.writeFileSync(path.join(srcDir, "sub", "datos.txt"), "contenido comprimido ".repeat(30));
  fs.writeFileSync(path.join(srcDir, ".oculto.txt"), "oculto");
  fs.writeFileSync(path.join(srcDir, "node_modules", "ignored", "x.js"), "ignored");
  const rootFile = path.join(root, "suelto.json");
  fs.writeFileSync(rootFile, '{"ok":true}');

  const provider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => env,
  });

  const zipPath = path.join(root, "backup.zip");
  const compRes = await provider.callTool("archive_files", {
    action: "compress",
    sources: [srcDir, rootFile],
    destination: zipPath,
  });
  const compRead = readToolResult(compRes);
  assert.ok(compRead);
  assert.equal(compRes.isError, false);
  assert.equal(compRead.data.action, "compress");
  assert.ok(fs.existsSync(zipPath));

  // Sin overwrite rechaza si ya existe el .zip
  const dupComp = await provider.callTool("archive_files", {
    action: "compress",
    sources: [rootFile],
    destination: zipPath,
  });
  assert.equal(dupComp.isError, true);
  assert.equal(readToolResult(dupComp)?.data.reason, "already_exists");

  // Extraer a carpeta nueva y verificar integridad exacta
  const extractDir = path.join(root, "extraido");
  const extRes = await provider.callTool("archive_files", {
    action: "extract",
    source: zipPath,
    destination: extractDir,
  });
  const extRead = readToolResult(extRes);
  assert.ok(extRead);
  assert.equal(extRes.isError, false);
  assert.equal(extRead.data.filesExtracted, 2);
  assert.equal(
    fs.readFileSync(path.join(extractDir, "paquete", "sub", "datos.txt"), "utf8"),
    "contenido comprimido ".repeat(30),
  );
  assert.equal(fs.readFileSync(path.join(extractDir, "suelto.json"), "utf8"), '{"ok":true}');
  assert.equal(fs.existsSync(path.join(extractDir, "paquete", ".oculto.txt")), false);
  assert.equal(fs.existsSync(path.join(extractDir, "paquete", "node_modules")), false);

  // Protección Zip Slip: un .zip manipulado con `../../pwn.txt` debe rechazarse sin escribir afuera
  const evilZip = path.join(root, "evil.zip");
  fs.writeFileSync(evilZip, buildRawZipWithEntry("../../pwn.txt", Buffer.from("malicioso")));
  const slipRes = await provider.callTool("archive_files", {
    action: "extract",
    source: evilZip,
    destination: path.join(root, "zona_segura"),
  });
  assert.equal(slipRes.isError, true);
  assert.equal(readToolResult(slipRes)?.data.reason, "denied");
  assert.equal(fs.existsSync(path.join(outside, "pwn.txt")), false);

  // Límite maxExtractBytes (Zip Bomb guard)
  const tinyLimitProvider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => env,
    archiveMaxExtractBytes: 50,
  });
  const bombRes = await tinyLimitProvider.callTool("archive_files", {
    action: "extract",
    source: zipPath,
    destination: path.join(root, "boom"),
  });
  assert.equal(bombRes.isError, true);

  // Symlink saliente en compresión debe rechazarse
  fs.writeFileSync(path.join(outside, "ext.txt"), "secreto");
  fs.symlinkSync(path.join(outside, "ext.txt"), path.join(srcDir, "escape.txt"));
  const linkComp = await provider.callTool("archive_files", {
    action: "compress",
    sources: [srcDir],
    destination: path.join(root, "bad.zip"),
  });
  assert.equal(linkComp.isError, true);
  assert.equal(readToolResult(linkComp)?.data.reason, "denied");

  // AbortSignal
  const ac = new AbortController();
  ac.abort();
  const cancelled = await provider.callTool(
    "archive_files",
    { action: "compress", sources: [rootFile], destination: path.join(root, "c.zip") },
    { signal: ac.signal },
  );
  assert.equal(readToolResult(cancelled)?.data.state, "cancelled");
});

// ───────────────────────── convert_file ─────────────────────────

test("convert_file: convierte/redimensiona mediante driver, valida categorías, overwrite, allowedDirectories y AbortSignal", async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-conv-out-");
  const env = makeEnv(root);

  const imgSrc = path.join(root, "foto.png");
  const vidSrc = path.join(root, "clip.mp4");
  const audSrc = path.join(root, "audio.mp3");
  fs.writeFileSync(imgSrc, "fake-png");
  fs.writeFileSync(vidSrc, "fake-mp4");
  fs.writeFileSync(audSrc, "fake-mp3");

  const calls: ConvertRequest[] = [];
  const fakeDriver: ConvertDriver = {
    async convert(req) {
      calls.push(req);
      fs.writeFileSync(req.destinationPath, `CONVERTED:${req.sourceExt}->${req.targetExt}`);
      return { backend: "mock-ffmpeg" };
    },
  };

  const provider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => env,
    convertDriver: fakeDriver,
  });

  // Imagen PNG -> WEBP redimensionada por 'format'
  const imgRes = await provider.callTool("convert_file", {
    source: imgSrc,
    format: "webp",
    width: 800,
    quality: 85,
  });
  const imgRead = readToolResult(imgRes);
  assert.ok(imgRead);
  assert.equal(imgRes.isError, false);
  assert.equal(imgRead.data.backend, "mock-ffmpeg");
  assert.equal(imgRead.data.destination, path.join(root, "foto.webp"));
  assert.equal(calls[0]?.width, 800);
  assert.equal(calls[0]?.quality, 85);

  // Sin overwrite rechaza destino existente
  const noOver = await provider.callTool("convert_file", { source: imgSrc, format: "webp" });
  assert.equal(noOver.isError, true);
  assert.equal(readToolResult(noOver)?.data.reason, "already_exists");

  // Con overwrite: true reemplaza
  const overRes = await provider.callTool("convert_file", {
    source: imgSrc,
    format: "webp",
    overwrite: true,
  });
  assert.equal(overRes.isError, false);

  // Video -> Audio extracción válida (.mp4 -> .mp3) y Video -> GIF
  const extractAudio = await provider.callTool("convert_file", { source: vidSrc, format: "mp3" });
  assert.equal(extractAudio.isError, false);
  const vidToGif = await provider.callTool("convert_file", { source: vidSrc, format: "gif", width: 480 });
  assert.equal(vidToGif.isError, false);

  // Conversión incompatible (.mp3 -> .png) y redimensionado de audio rechazados
  const badCat = await provider.callTool("convert_file", { source: audSrc, format: "png" });
  assert.equal(badCat.isError, true);
  assert.equal(readToolResult(badCat)?.data.reason, "incompatible_formats");

  const badResize = await provider.callTool("convert_file", { source: audSrc, format: "wav", width: 100 });
  assert.equal(badResize.isError, true);

  // Fuera de allowedDirectories -> denied
  const outDest = await provider.callTool("convert_file", {
    source: imgSrc,
    destination: path.join(outside, "f.jpg"),
  });
  assert.equal(outDest.isError, true);
  assert.equal(readToolResult(outDest)?.data.reason, "denied");

  // AbortSignal
  const ac = new AbortController();
  ac.abort();
  const cancelled = await provider.callTool(
    "convert_file",
    { source: imgSrc, format: "jpg" },
    { signal: ac.signal },
  );
  assert.equal(readToolResult(cancelled)?.data.state, "cancelled");
});

// ───────────────────────── Regresiones de symlinks y lotes ─────────────────────────

test("regresiones files_write: bloquea symlinks colgantes en destino, symlinks preexistentes al extraer y symlinks rotos en origen", async () => {
  const root = makeTempDir();
  const outside = makeTempDir("jarvis-reg-out-");
  const env = makeEnv(root);

  const srcFile = path.join(root, "origen.txt");
  const imgSrc = path.join(root, "img.png");
  fs.writeFileSync(srcFile, "contenido");
  fs.writeFileSync(imgSrc, "png-bytes");

  const provider = new FilesWriteProvider({
    allowedDirectories: () => [root],
    environment: async () => env,
    convertDriver: {
      async convert(req) {
        fs.writeFileSync(req.destinationPath, "converted");
        return { backend: "mock" };
      },
    },
  });

  // Symlink colgante apuntando fuera de allowedDirectories
  const danglingTarget = path.join(outside, "escapado.txt");
  const danglingLink = path.join(root, "colgante.txt");
  fs.symlinkSync(danglingTarget, danglingLink);

  const danglingWrite = await provider.callTool("write_file", { path: danglingLink, content: "malo" });
  assert.equal(danglingWrite.isError, true);
  assert.equal(readToolResult(danglingWrite)?.data.reason, "denied");
  assert.equal(fs.existsSync(danglingTarget), false);

  const danglingCopy = await provider.callTool("copy_file", { source: srcFile, destination: danglingLink, overwrite: true });
  assert.equal(danglingCopy.isError, true);
  assert.equal(readToolResult(danglingCopy)?.data.reason, "denied");
  assert.equal(fs.existsSync(danglingTarget), false);

  for (const overwrite of [false, true]) {
    const danglingMove = await provider.callTool("move_file", {
      items: [{ source: srcFile, destination: danglingLink }],
      overwrite,
    });
    assert.equal(danglingMove.isError, true);
    assert.match(readToolResult(danglingMove)?.text ?? "", /\[DENIED\]/);
    assert.equal(fs.existsSync(srcFile), true);
    assert.equal(fs.existsSync(danglingTarget), false);
  }

  const danglingZipTarget = path.join(outside, "ext.zip");
  const danglingZipLink = path.join(root, "colgante.zip");
  fs.symlinkSync(danglingZipTarget, danglingZipLink);
  const danglingCompress = await provider.callTool("archive_files", {
    action: "compress",
    sources: [srcFile],
    destination: danglingZipLink,
    overwrite: true,
  });
  assert.equal(danglingCompress.isError, true);
  assert.equal(readToolResult(danglingCompress)?.data.reason, "denied");
  assert.equal(fs.existsSync(danglingZipTarget), false);

  const danglingImgTarget = path.join(outside, "out.webp");
  const danglingImgLink = path.join(root, "colgante.webp");
  fs.symlinkSync(danglingImgTarget, danglingImgLink);
  const danglingConvert = await provider.callTool("convert_file", {
    source: imgSrc,
    destination: danglingImgLink,
    overwrite: true,
  });
  assert.equal(danglingConvert.isError, true);
  assert.equal(readToolResult(danglingConvert)?.data.reason, "denied");
  assert.equal(fs.existsSync(danglingImgTarget), false);

  // Symlink preexistente dentro de carpeta destino durante archive extract (overwrite: true)
  const payloadFile = path.join(root, "sub", "item.txt");
  fs.mkdirSync(path.dirname(payloadFile), { recursive: true });
  fs.writeFileSync(payloadFile, "seguro");
  const goodZip = path.join(root, "good.zip");
  const zipRes = await provider.callTool("archive_files", {
    action: "compress",
    sources: [path.join(root, "sub")],
    destination: goodZip,
  });
  assert.equal(zipRes.isError, false);

  const extractDest = path.join(root, "extract_symlink_trap");
  fs.mkdirSync(path.join(extractDest, "sub"), { recursive: true });
  const trapTarget = path.join(outside, "intacto.txt");
  fs.writeFileSync(trapTarget, "original");
  fs.symlinkSync(trapTarget, path.join(extractDest, "sub", "item.txt"));

  const extTrap = await provider.callTool("archive_files", {
    action: "extract",
    source: goodZip,
    destination: extractDest,
    overwrite: true,
  });
  assert.equal(extTrap.isError, true);
  assert.equal(readToolResult(extTrap)?.data.reason, "denied");
  assert.equal(fs.readFileSync(trapTarget, "utf8"), "original");

  // Symlink roto en carpeta origen devuelve error estructurado (no excepción no capturada)
  const brokenDir = path.join(root, "con_roto");
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.symlinkSync(path.join(root, "no_existe_archivo.txt"), path.join(brokenDir, "roto.txt"));

  const copyBroken = await provider.callTool("copy_file", {
    source: brokenDir,
    destination: path.join(root, "copia_roto"),
  });
  assert.equal(copyBroken.isError, true);
  assert.match(readToolResult(copyBroken)?.text ?? "", /broken symbolic link/i);

  const compressBroken = await provider.callTool("archive_files", {
    action: "compress",
    sources: [brokenDir],
    destination: path.join(root, "broken.zip"),
  });
  assert.equal(compressBroken.isError, true);
  assert.match(readToolResult(compressBroken)?.text ?? "", /broken symbolic link/i);

  // Lote move_file: un item con destino de tipo incompatible/error no aborta al siguiente válido
  const m1 = path.join(root, "m1.txt");
  const m2 = path.join(root, "m2.txt");
  const occupiedDir = path.join(root, "carpeta_ocupada");
  fs.writeFileSync(m1, "m1");
  fs.writeFileSync(m2, "m2");
  fs.mkdirSync(occupiedDir);

  const batchCont = await provider.callTool("move_file", {
    items: [
      { source: m1, destination: occupiedDir },
      { source: m2, destination: path.join(root, "m2_movido.txt") },
    ],
    overwrite: true,
  });
  const batchData = readToolResult(batchCont);
  assert.ok(batchData);
  assert.equal(batchCont.isError, false);
  assert.equal(batchData.data.state, "partial");
  assert.equal(batchData.data.moved, 1);
  assert.equal(batchData.data.failed, 1);
  assert.equal(fs.existsSync(m1), true);
  assert.equal(fs.existsSync(path.join(root, "m2_movido.txt")), true);
});

