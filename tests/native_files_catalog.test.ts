/**
 * Los grupos nativos de archivos y multimedia en el catálogo (`files_read`, `files_write`, `multimedia`): el manifest coincide con lo que sirve cada proveedor, y las
 * reglas por herramienta (nivel, poscondición, rutas en lote, Guard) cubren las que escriben.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { postconditionOf } from "../src/core/engine/postcondition.ts";
import { precheckCall, normalizeText } from "../src/core/engine/precheck.ts";
import type { PrecheckInput } from "../src/core/engine/precheck.ts";
import { approvalKey } from "../src/core/policy/approvalKey.ts";
import { Guard } from "../src/core/policy/guard.ts";
import { expandedArgEntries, pathValuesOf } from "../src/core/policy/pathArgs.ts";
import { approvalTierOf } from "../src/core/policy/tiers.ts";
import { applyDestination, SYSTEM_TOOL_MANIFEST } from "../src/core/tools/manifest.ts";
import { isPathWriteTool, placedPathArg } from "../src/core/tools/toolTargets.ts";
import type { ExecutableRoute } from "../src/core/types.ts";
import { FilesReadProvider } from "../src/tools/files_read/filesReadProvider.ts";
import { FilesWriteProvider } from "../src/tools/files_write/filesWriteProvider.ts";
import { MultimediaProvider } from "../src/tools/multimedia/multimediaProvider.ts";
import { SystemProvider } from "../src/tools/system/systemProvider.ts";
import { WebSearchProvider } from "../src/tools/web/webSearchProvider.ts";

const GROUPS: ReadonlyArray<readonly [ExecutableRoute, string, { listTools(): Promise<import("../src/core/types.ts").MCPTool[]> }]> = [
  ["files_read", "jarvis_files_read", new FilesReadProvider()],
  ["files_write", "jarvis_files_write", new FilesWriteProvider()],
  ["multimedia", "jarvis_multimedia", new MultimediaProvider()],
  ["system", "jarvis_system", new SystemProvider()],
  ["web", "jarvis_web", new WebSearchProvider()],
];

test("catálogo: cada grupo (archivos, multimedia, sistema y web) ofrece exactamente las tools de su proveedor, con parámetros y notas que existen en su esquema", async () => {
  for (const [route, server, provider] of GROUPS) {
    const served = await provider.listTools();
    const declared = SYSTEM_TOOL_MANIFEST.filter((d) => d.route === route && d.server === server && d.internal !== true);
    assert.deepEqual(
      declared.map((d) => d.name).sort(),
      served.map((t) => t.name).sort(),
      `${route}: el catálogo y el proveedor ${server} no ofrecen las mismas tools`,
    );
    assert.deepEqual(applyDestination(route, served).map((t) => t.name).sort(), served.map((t) => t.name).sort());
    for (const d of declared) {
      const props = Object.keys((served.find((t) => t.name === d.name)!.inputSchema as { properties?: object }).properties ?? {});
      for (const param of d.params ?? props) assert.ok(props.includes(param), `${d.name}: el parámetro '${param}' no existe en el esquema del proveedor`);
      for (const param of Object.keys(d.notes ?? {})) assert.ok(props.includes(param), `${d.name}: la nota de '${param}' apunta a un parámetro que no existe`);
      const required = ((served.find((t) => t.name === d.name)!.inputSchema as { required?: string[] }).required ?? []);
      for (const param of required) assert.ok((d.params ?? props).includes(param), `${d.name}: el parámetro obligatorio '${param}' quedó fuera de params`);
    }
  }
});

test("catálogo: lecturas sin aprobación, escrituras con ella, y multimedia como control de procesos", () => {
  const byName = (name: string) => SYSTEM_TOOL_MANIFEST.find((d) => d.name === name)!;
  for (const name of ["find_files", "list_folder", "search_content", "read_file"]) {
    assert.equal(byName(name).policy.mutates, false, name);
    assert.equal(byName(name).policy.requiresApproval, false, name);
  }
  for (const name of ["write_file", "edit_file", "convert_file", "create_folder", "copy_file", "move_file", "delete_file", "archive_files"]) {
    assert.equal(byName(name).policy.mutates, true, name);
    assert.equal(byName(name).policy.requiresApproval, true, name);
  }
  for (const name of ["play_media", "media_control"]) assert.equal(byName(name).policy.capability, "PROCESS_CONTROL", name);
});

// ───────────────────────── Niveles ─────────────────────────

const ENV = { platform: "windows" as const, home: "C:\\Users\\Ana", desktop: "C:\\Users\\Ana\\Desktop", documents: "C:\\Users\\Ana\\Documents", downloads: "C:\\Users\\Ana\\Downloads" };
const FOLDERS = [ENV.home, ENV.desktop, ENV.documents, ENV.downloads];
const disk = (existing: string[] = []) => ({ exists: (p: string) => existing.includes(p) || FOLDERS.includes(p) });
const tier = (tool: string, args: Record<string, unknown>, existing: string[] = []) => approvalTierOf(tool, args, ENV, disk(existing));

test("niveles: crear lo nuevo dentro de las carpetas del usuario es verde; sobrescribir y borrar, rojo; el resto, amarillo", () => {
  const file = "C:\\Users\\Ana\\Desktop\\nota.md";
  assert.equal(tier("create_folder", { path: "C:\\Users\\Ana\\Documents\\Proyectos" }), "green");
  assert.equal(tier("create_folder", { path: "D:\\datos\\x" }), "yellow");
  assert.equal(tier("write_file", { path: file, content: "x" }), "green");
  assert.equal(tier("write_file", { path: file, content: "x" }, [file]), "red", "reescribir lo que existe");
  assert.equal(tier("write_file", { path: file, content: "x", mode: "append" }, [file]), "yellow");
  assert.equal(tier("write_file", { path: file, content: "x", mode: "create_only" }, [file]), "yellow");
  assert.equal(tier("write_file", { path: "C:\\Users\\Ana\\Nueva\\nota.md", content: "x" }), "yellow", "sin la carpeta contenedora");
  assert.equal(tier("write_file", { path: "C:\\Users\\Ana\\Nueva\\nota.md", content: "x", createFolders: true }), "green", "la herramienta crea la carpeta");
  assert.equal(tier("write_file", { path: "D:\\datos\\nota.md", content: "x" }), "yellow");
  assert.equal(tier("edit_file", { path: file, oldText: "a", newText: "b" }, [file]), "yellow");
  assert.equal(tier("delete_file", { path: file }, [file]), "red");
  assert.equal(tier("play_media", { query: "jazz" }), "green");
  assert.equal(tier("media_control", { action: "pause" }), "green");
});

test("niveles: copiar, mover (en lote), comprimir y convertir miran origen y destino", () => {
  const a = "C:\\Users\\Ana\\Downloads\\a.pdf";
  const b = "C:\\Users\\Ana\\Documents\\a.pdf";
  assert.equal(tier("copy_file", { source: a, destination: b }, [a]), "green");
  assert.equal(tier("copy_file", { source: a, destination: b }, [a, b]), "red", "el destino ya existe");
  assert.equal(tier("copy_file", { source: "D:\\a.pdf", destination: b }, ["D:\\a.pdf"]), "yellow", "el origen está fuera");
  assert.equal(tier("move_file", { items: [{ source: a, destination: b }] }, [a]), "green");
  assert.equal(tier("move_file", { items: [{ source: a, destination: b }, { source: a, destination: "C:\\Users\\Ana\\Desktop\\a.pdf" }] }, [a]), "green");
  assert.equal(tier("move_file", { items: [{ source: a, destination: b }] }, [a, b]), "red");
  assert.equal(tier("move_file", { items: [{ source: a, destination: "D:\\x\\a.pdf" }] }, [a]), "yellow", "destino fuera de las carpetas del usuario");
  assert.equal(tier("move_file", { items: [] }), "yellow");
  assert.equal(tier("move_file", {}), "yellow");
  const zip = "C:\\Users\\Ana\\Desktop\\todo.zip";
  assert.equal(tier("archive_files", { action: "compress", sources: [a], destination: zip }, [a]), "green");
  assert.equal(tier("archive_files", { action: "compress", sources: [a], destination: zip }, [a, zip]), "red");
  assert.equal(tier("archive_files", { action: "extract", source: zip, destination: "C:\\Users\\Ana\\Desktop\\todo" }, [zip]), "yellow");
  assert.equal(tier("convert_file", { source: "C:\\Users\\Ana\\Desktop\\foto.png", format: "webp" }, ["C:\\Users\\Ana\\Desktop\\foto.png"]), "green", "destino derivado");
  assert.equal(tier("convert_file", { source: "C:\\Users\\Ana\\Desktop\\foto.png", format: "webp" }, ["C:\\Users\\Ana\\Desktop\\foto.png", "C:\\Users\\Ana\\Desktop\\foto.webp"]), "red");
  assert.equal(tier("convert_file", { source: "C:\\Users\\Ana\\Desktop\\foto.png" }), "yellow", "sin formato ni destino no se sabe qué deja");
});

// ───────────────────────── Poscondiciones ─────────────────────────

const view = (files: Record<string, number>, dirs: string[] = []) => ({
  exists: (p: string) => p in files || dirs.includes(p),
  isDirectory: (p: string) => dirs.includes(p),
  size: (p: string) => files[p] ?? 0,
});
const abs = (...parts: string[]) => path.resolve(path.sep, "datos", ...parts);

test("poscondiciones: cada escritura se comprueba en el disco; sin ruta absoluta o con un lote mal formado no se decide", () => {
  const f = abs("a.txt");
  const dir = abs("nueva");
  assert.equal(postconditionOf("create_folder", { path: dir }, view({}, [dir])), "met");
  assert.equal(postconditionOf("create_folder", { path: dir }, view({ [dir]: 1 })), "unmet", "un archivo no es una carpeta");
  assert.equal(postconditionOf("write_file", { path: f, content: "x" }, view({ [f]: 3 })), "met");
  assert.equal(postconditionOf("write_file", { path: f, content: "x" }, view({ [f]: 0 })), "unmet", "vacío con texto para escribir");
  assert.equal(postconditionOf("write_file", { path: f, content: "x", mode: "append" }, view({ [f]: 0 })), "met");
  assert.equal(postconditionOf("edit_file", { path: f, oldText: "a", newText: "b" }, view({ [f]: 3 })), "met");
  assert.equal(postconditionOf("edit_file", { path: f, oldText: "a", newText: "b" }, view({})), "unmet");
  const copy = abs("copia.txt");
  assert.equal(postconditionOf("copy_file", { source: f, destination: copy }, view({ [f]: 1, [copy]: 1 })), "met");
  assert.equal(postconditionOf("copy_file", { source: f, destination: copy }, view({ [f]: 1 })), "unmet");
  const moved = abs("movido.txt");
  assert.equal(postconditionOf("move_file", { items: [{ source: f, destination: moved }] }, view({ [moved]: 1 })), "met");
  assert.equal(postconditionOf("move_file", { items: [{ source: f, destination: moved }] }, view({ [f]: 1, [moved]: 1 })), "unmet", "una copia no es un movimiento");
  assert.equal(postconditionOf("move_file", { items: [{ source: f, destination: moved }, { source: abs("b"), destination: abs("c") }] }, view({ [moved]: 1 })), "unmet");
  assert.equal(postconditionOf("move_file", { items: [{ source: "relativa", destination: moved }] }, view({})), null);
  assert.equal(postconditionOf("move_file", { items: "no" }, view({})), null);
  assert.equal(postconditionOf("delete_file", { path: f }, view({})), "met");
  assert.equal(postconditionOf("delete_file", { path: f }, view({ [f]: 1 })), "unmet");
  const zip = abs("todo.zip");
  assert.equal(postconditionOf("archive_files", { action: "compress", destination: zip }, view({ [zip]: 10 })), "met");
  assert.equal(postconditionOf("archive_files", { action: "compress", destination: zip }, view({ [zip]: 0 })), "unmet");
  assert.equal(postconditionOf("archive_files", { action: "extract", destination: dir }, view({}, [dir])), "met");
  const png = abs("foto.png");
  const webp = abs("foto.webp");
  assert.equal(postconditionOf("convert_file", { source: png, format: "webp" }, view({ [png]: 1, [webp]: 1 })), "met", "destino derivado");
  assert.equal(postconditionOf("convert_file", { source: png, destination: webp }, view({ [png]: 1 })), "unmet");
  assert.equal(postconditionOf("play_media", { query: "x" }, view({})), null, "no deja nada en el disco");
  assert.equal(postconditionOf("write_file", { path: "relativa.txt", content: "x" }, view({})), null);
});

// ───────────────────────── Rutas en lotes ─────────────────────────

test("pathValuesOf: junta rutas simples, listas (`paths`, `sources`) y pares de `items`", () => {
  assert.deepEqual(pathValuesOf({ path: "a", content: "no es ruta" }), ["a"]);
  assert.deepEqual(pathValuesOf({ sources: ["a", "b"], destination: "c" }).sort(), ["a", "b", "c"]);
  assert.deepEqual(pathValuesOf({ items: [{ source: "a", destination: "b" }, { source: "c", destination: "d" }], overwrite: true }).sort(), ["a", "b", "c", "d"]);
  assert.deepEqual(pathValuesOf({ items: [null, 5, ["x"], { source: "", destination: "z" }] }), ["z"]);
  assert.deepEqual(expandedArgEntries({ items: [{ source: "a", destination: "b" }] }), [["source", "a"], ["destination", "b"]]);
  assert.deepEqual(pathValuesOf({ query: "texto", format: "png", oldText: "x" }), [], "los textos no son rutas");
});

test("aprobar siempre: la clave de un lote incluye todas sus rutas", () => {
  const one = approvalKey("move_file", { items: [{ source: "C:/a/x.txt", destination: "C:/b/x.txt" }] });
  const two = approvalKey("move_file", { items: [{ source: "C:/a/x.txt", destination: "C:/b/x.txt" }, { source: "C:/a/y.txt", destination: "C:/b/y.txt" }] });
  assert.notEqual(one, two);
  assert.ok(two.includes("y.txt"));
});

// ───────────────────────── Guard ─────────────────────────

const PROJECT = path.resolve("proyecto-jarvis");
const scope = { protectedDirs: [PROJECT], relativeBases: [PROJECT] };
const W = "jarvis_files_write";

test("Guard: una ruta protegida dentro de un lote (`items`, `sources`) se deniega igual que una ruta simple", () => {
  const inside = path.join(PROJECT, "src", "a.ts");
  assert.equal(Guard.evaluate(W, "write_file", { path: inside, content: "x" }, scope).decision, "DENY");
  assert.equal(Guard.evaluate(W, "move_file", { items: [{ source: "C:\\x\\a.txt", destination: inside }] }, scope).decision, "DENY");
  assert.equal(Guard.evaluate(W, "move_file", { items: [{ source: inside, destination: "C:\\x\\a.txt" }] }, scope).decision, "DENY");
  assert.equal(Guard.evaluate(W, "archive_files", { action: "compress", sources: [inside], destination: "C:\\x\\a.zip" }, scope).decision, "DENY");
  assert.equal(Guard.evaluate(W, "create_folder", { path: path.join(PROJECT, "nueva") }, scope).decision, "DENY");
  assert.equal(Guard.evaluate(W, "delete_file", { path: inside }, scope).decision, "DENY");
  assert.equal(Guard.evaluate(W, "move_file", { items: [{ source: "C:\\x\\a.txt", destination: "C:\\x\\b.txt" }] }, scope).decision, "APPROVAL");
});

test("Guard: el texto que se escribe y los argumentos que no son rutas no se toman por rutas ni por órdenes", () => {
  const elsewhere = path.resolve("otro", "nota.txt");
  assert.notEqual(Guard.evaluate(W, "write_file", { path: elsewhere, content: "rm -rf / y src/core/guard.ts" }, scope).decision, "DENY");
  assert.notEqual(Guard.evaluate(W, "edit_file", { path: elsewhere, oldText: "format c:", newText: "src" }, scope).decision, "DENY");
  assert.notEqual(Guard.evaluate(W, "convert_file", { source: elsewhere, format: "png" }, scope).decision, "DENY", "`png` no es una carpeta del proyecto");
  assert.equal(Guard.evaluate("jarvis_files_read", "read_file", { path: path.join(PROJECT, "readme.md") }, scope).decision, "ALLOW", "leer el proyecto sigue permitido");
  assert.equal(Guard.evaluate("jarvis_files_read", "search_content", { query: "src", path: PROJECT }, scope).decision, "ALLOW");
});

// ───────────────────────── Pre-chequeo ─────────────────────────

const input = (over: Partial<PrecheckInput> & Pick<PrecheckInput, "tool" | "args">): PrecheckInput => ({
  kind: "read",
  sources: { text: normalizeText("mostrame lo que hay"), complete: true },
  environment: { platform: "windows", home: "C:\\Users\\Ana", documents: "C:\\Users\\Ana\\Documents" },
  ...over,
});
const noAnalyzer = async () => null;

test("pre-chequeo: los alias de las herramientas de archivos (`desktop`, `~/…`) son carpetas conocidas; una ruta inventada se rechaza", async () => {
  for (const p of ["home", "desktop", "documents", "downloads", "~", "~/Documents"]) {
    assert.equal(await precheckCall(input({ tool: "list_folder", args: { path: p } }), noAnalyzer), null, p);
  }
  assert.equal((await precheckCall(input({ tool: "list_folder", args: { path: "D:\\inventada\\carpeta" } }), noAnalyzer))?.review, "args_invalid");
});

test("pre-chequeo: un destino de lote que no sale de ningún lado se rechaza, y uno dentro de las carpetas del usuario pasa", async () => {
  const write = (destination: string) =>
    precheckCall(input({ tool: "move_file", kind: "write", args: { items: [{ source: "C:\\Users\\Ana\\Documents\\a.txt", destination }] }, sources: { text: normalizeText("mové a.txt (C:\\Users\\Ana\\Documents\\a.txt)"), complete: true } }), noAnalyzer);
  assert.equal(await write("C:\\Users\\Ana\\Documents\\b.txt"), null);
  assert.equal((await write("D:\\proyectos\\facturacion\\a.txt"))?.review, "args_invalid");
});

// ───────────────────────── Destinos de escritura ─────────────────────────

test("destinos: toda tool que deja algo en una ruta figura en toolTargets, con el argumento correcto; borrar y las que no escriben, no", () => {
  const targets: Record<string, string> = {
    write_file: "path",
    edit_file: "path",
    create_folder: "path",
    copy_file: "destination",
    move_file: "destination",
    archive_files: "destination",
    convert_file: "destination",
    download_file: "destination",
  };
  for (const [tool, arg] of Object.entries(targets)) {
    assert.equal(isPathWriteTool(tool), true, `${tool}: falta en toolTargets`);
    assert.equal(placedPathArg(tool), arg, tool);
  }
  for (const tool of ["delete_file", "read_file", "list_folder", "find_files", "search_content", "run_command", "play_media", "system_info", "clipboard"]) {
    assert.equal(isPathWriteTool(tool), false, tool);
  }
});

test("pre-chequeo: en una escritura no valen comodines ni nombres reservados de Windows; en una lectura el comodín no lo juzga esta regla", async () => {
  const write = (tool: string, args: Record<string, unknown>) =>
    precheckCall(input({ tool, kind: "write", args, sources: { text: "", complete: true } }), noAnalyzer);
  const base = ["C:", "Users", "Ana", "Documents"].join(String.fromCharCode(92));
  const at = (name: string): string => `${base}${String.fromCharCode(92)}${name}`;
  assert.match((await write("write_file", { path: at("a*.txt"), content: "x" }))?.reason ?? "", /wildcard/);
  assert.match((await write("write_file", { path: at("CON.txt"), content: "x" }))?.reason ?? "", /reserved/);
  assert.match((await write("create_folder", { path: at("carpeta.") }))?.reason ?? "", /ends with a dot/);
  assert.match((await write("move_file", { items: [{ source: at("a.txt"), destination: at("b?.txt") }] }))?.reason ?? "", /wildcard/);
  assert.equal(await write("write_file", { path: at("nota.txt"), content: "x" }), null);
});
