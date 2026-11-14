import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { codeAnswersOk, postconditionOf } from "../src/core/engine/postcondition.ts";

function withDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-post-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("create_directory: la carpeta existe (met) o no (unmet); un archivo no es una carpeta", () =>
  withDir((dir) => {
    fs.mkdirSync(path.join(dir, "nueva"));
    fs.writeFileSync(path.join(dir, "archivo.txt"), "x");
    assert.equal(postconditionOf("create_directory", { path: path.join(dir, "nueva") }), "met");
    assert.equal(postconditionOf("create_directory", { path: path.join(dir, "no_existe") }), "unmet");
    assert.equal(postconditionOf("create_directory", { path: path.join(dir, "archivo.txt") }), "unmet");
  }));

test("move_file: el origen ya no está y el destino sí (met); una copia, o nada, es unmet", () =>
  withDir((dir) => {
    const a = path.join(dir, "a.txt");
    const b = path.join(dir, "b.txt");
    fs.writeFileSync(b, "x");
    assert.equal(postconditionOf("move_file", { source: a, destination: b }), "met", "movido");
    fs.writeFileSync(a, "x");
    assert.equal(postconditionOf("move_file", { source: a, destination: b }), "unmet", "copia: el origen sigue");
    fs.rmSync(a);
    fs.rmSync(b);
    assert.equal(postconditionOf("move_file", { source: a, destination: b }), "unmet", "no hay destino");
    // A una carpeta: el archivo queda dentro de ella.
    const folder = path.join(dir, "carpeta");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "a.txt"), "x");
    assert.equal(postconditionOf("move_file", { source: a, destination: folder }), "met");
  }));

test("write_file: existe (met); vacío con texto para escribir es unmet; en append solo importa que exista", () =>
  withDir((dir) => {
    const f = path.join(dir, "nota.txt");
    assert.equal(postconditionOf("write_file", { path: f, content: "hola" }), "unmet", "no existe");
    fs.writeFileSync(f, "hola");
    assert.equal(postconditionOf("write_file", { path: f, content: "hola" }), "met");
    fs.writeFileSync(f, "");
    assert.equal(postconditionOf("write_file", { path: f, content: "hola" }), "unmet", "se pidió texto y el archivo está vacío");
    assert.equal(postconditionOf("write_file", { path: f, content: "hola", mode: "append" }), "met");
    assert.equal(postconditionOf("write_file", { path: f, content: "" }), "met", "un archivo vacío a propósito");
    assert.equal(postconditionOf("write_file", { path: dir, content: "x" }), "unmet", "una carpeta no es un archivo");
  }));

test("lo que no se puede comprobar devuelve null: ruta relativa, referencia sin resolver, otra herramienta, sin argumentos", () => {
  assert.equal(postconditionOf("create_directory", { path: "relativa/x" }), null);
  assert.equal(postconditionOf("write_file", { path: path.join(os.tmpdir(), "{{ref:r1}}"), content: "x" }), null);
  assert.equal(postconditionOf("run_command", { command: "Get-Date" }), null);
  assert.equal(postconditionOf("create_directory", null), null);
  assert.equal(postconditionOf("create_directory", { path: 5 }), null);
  assert.equal(postconditionOf("create_directory", { path: path.join(os.tmpdir(), "x") }, { exists: () => { throw new Error("disco"); }, isDirectory: () => true, size: () => 0 }), null, "un error al leer el disco no decide");
});

test("codeAnswersOk: solo lecturas deterministas con estado ok y contenido", () => {
  assert.ok(codeAnswersOk("list_directory", "ok", "[DIR] a\n[FILE] b.txt"));
  assert.ok(codeAnswersOk("read_file", "ok", "linea 1"));
  assert.ok(!codeAnswersOk("list_directory", "ok", "Directorio vacío."), "vacío no es un dato");
  assert.ok(!codeAnswersOk("list_directory", "ok", "   "));
  assert.ok(!codeAnswersOk("list_directory", "ok", null));
  assert.ok(!codeAnswersOk("list_directory", "no_data", "x"));
  assert.ok(!codeAnswersOk("web_search", "ok", "status: partial"), "un extracto de buscador lo juzga el modelo");
  assert.ok(!codeAnswersOk("run_command", "ok", "status: ok · exit code: 0"), "la salida de un comando la juzga el modelo");
});
