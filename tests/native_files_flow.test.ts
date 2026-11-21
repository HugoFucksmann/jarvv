/**
 * Las tools nativas de archivos de punta a punta: el motor real (`runTask`) con los proveedores reales (`jarvis_files_read`, `jarvis_files_write`) sobre una carpeta
 * temporal y dobles solo para los modelos. Comprueba el catálogo, la aprobación por niveles, la poscondición en el disco y el resultado en el disco.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { IMCPServer } from "../src/core/mcp/types.ts";
import { serverOf } from "../src/core/tools/manifest.ts";
import type { ExecutableRoute } from "../src/core/types.ts";
import { FilesReadProvider } from "../src/tools/files_read/filesReadProvider.ts";
import { FilesWriteProvider } from "../src/tools/files_write/filesWriteProvider.ts";
import { runNative, type NativeOptions, type NativeOutcome } from "./helpers/native_flow.ts";

const providersFor = (root: string): Record<string, IMCPServer> => ({
  jarvis_files_read: new FilesReadProvider({ environment: async () => ({ platform: "windows", home: root }) }) as unknown as IMCPServer,
  jarvis_files_write: new FilesWriteProvider({ environment: async () => ({ platform: "windows", home: root }) }) as unknown as IMCPServer,
});

/** Corre una tarea de un solo paso con la tool y los argumentos dados; `approve` responde a las confirmaciones del usuario. */
const runWith = (root: string, route: ExecutableRoute, tool: string, args: Record<string, unknown>, options: NativeOptions = {}): Promise<NativeOutcome> =>
  runNative(providersFor(root), root, route, tool, args, options);

const withRoot = async (fn: (root: string) => Promise<void>): Promise<void> => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-native-")));
  try {
    await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test("el catálogo ubica cada grupo en su servidor nativo", () => {
  assert.equal(serverOf("files_read"), "jarvis_files_read");
  assert.equal(serverOf("files_write"), "jarvis_files_write");
  assert.equal(serverOf("multimedia"), "jarvis_multimedia");
});

test("lectura: list_folder y read_file se despachan sin confirmación y la tarea se completa", async () => {
  await withRoot(async (root) => {
    fs.writeFileSync(path.join(root, "nota.txt"), "hola\nmundo\n");
    const list = await runWith(root, "files_read", "list_folder", { path: root });
    assert.equal(list.state, "completed", JSON.stringify(list));
    assert.equal(list.approvals, 0);
    assert.deepEqual(list.dispatched, ["list_folder"]);
    const read = await runWith(root, "files_read", "read_file", { path: path.join(root, "nota.txt") });
    assert.equal(read.state, "completed", JSON.stringify(read));
    assert.equal(read.calls[0]?.status, "ok");
  });
});

test("escritura verde: un archivo nuevo dentro de las carpetas del usuario se crea sin confirmación y la poscondición lo comprueba", async () => {
  await withRoot(async (root) => {
    const file = path.join(root, "nota.txt");
    const out = await runWith(root, "files_write", "write_file", { path: file, content: "hola", mode: "create_only" });
    assert.equal(out.state, "completed", JSON.stringify(out));
    assert.equal(out.approvals, 0, "verde: no pide al usuario");
    assert.equal(fs.readFileSync(file, "utf8"), "hola");
  });
});

test("escritura roja: sobrescribir un archivo que existe pide confirmación; con un «no» no se toca el archivo", async () => {
  await withRoot(async (root) => {
    const file = path.join(root, "nota.txt");
    fs.writeFileSync(file, "original");
    const refused = await runWith(root, "files_write", "write_file", { path: file, content: "nuevo", mode: "rewrite" }, { approve: false });
    assert.equal(refused.approvals >= 1, true, "rojo: siempre pide al usuario");
    assert.equal(refused.dispatched.length, 0, "rechazada: no se despacha");
    assert.equal(fs.readFileSync(file, "utf8"), "original");
    const accepted = await runWith(root, "files_write", "write_file", { path: file, content: "nuevo", mode: "rewrite" }, { approve: true });
    assert.equal(accepted.state, "completed", JSON.stringify(accepted));
    assert.equal(fs.readFileSync(file, "utf8"), "nuevo");
  });
});

test("mover en lote: items {source, destination}; destino nuevo en carpetas del usuario es verde y deja el origen vacío", async () => {
  await withRoot(async (root) => {
    fs.writeFileSync(path.join(root, "a.txt"), "a");
    fs.writeFileSync(path.join(root, "b.txt"), "b");
    fs.mkdirSync(path.join(root, "destino"));
    const out = await runWith(root, "files_write", "move_file", {
      items: [
        { source: path.join(root, "a.txt"), destination: path.join(root, "destino", "a.txt") },
        { source: path.join(root, "b.txt"), destination: path.join(root, "destino", "b.txt") },
      ],
    });
    assert.equal(out.state, "completed", JSON.stringify(out));
    assert.equal(out.approvals, 0);
    assert.deepEqual(fs.readdirSync(path.join(root, "destino")).sort(), ["a.txt", "b.txt"]);
    assert.equal(fs.existsSync(path.join(root, "a.txt")), false);
  });
});

test("borrar: siempre pide confirmación; aprobado, el archivo desaparece", async () => {
  await withRoot(async (root) => {
    const file = path.join(root, "borrar.txt");
    fs.writeFileSync(file, "x");
    const out = await runWith(root, "files_write", "delete_file", { path: file, permanent: true }, { approve: true });
    assert.equal(out.approvals >= 1, true);
    assert.equal(out.state, "completed", JSON.stringify(out));
    assert.equal(fs.existsSync(file), false);
  });
});

test("crear carpeta, copiar y comprimir: tres pasos de escritura encadenados dejan lo pedido en el disco", async () => {
  await withRoot(async (root) => {
    fs.writeFileSync(path.join(root, "a.txt"), "contenido");
    const folder = await runWith(root, "files_write", "create_folder", { path: path.join(root, "nueva", "anidada") });
    assert.equal(folder.state, "completed", JSON.stringify(folder));
    assert.equal(fs.statSync(path.join(root, "nueva", "anidada")).isDirectory(), true);
    const copy = await runWith(root, "files_write", "copy_file", { source: path.join(root, "a.txt"), destination: path.join(root, "nueva", "a.txt") });
    assert.equal(copy.state, "completed", JSON.stringify(copy));
    assert.equal(fs.readFileSync(path.join(root, "nueva", "a.txt"), "utf8"), "contenido");
    const zip = await runWith(root, "files_write", "archive_files", { action: "compress", sources: [path.join(root, "nueva")], destination: path.join(root, "nueva.zip") });
    assert.equal(zip.state, "completed", JSON.stringify(zip));
    assert.equal(fs.statSync(path.join(root, "nueva.zip")).size > 0, true);
  });
});
