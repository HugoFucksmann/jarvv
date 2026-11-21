import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { codeAnswersOk, postconditionOf } from "../src/core/engine/postcondition.ts";

test("lo que no se puede comprobar devuelve null: herramienta sin poscondición de disco, sin argumentos", () => {
  assert.equal(postconditionOf("run_command", { command: "Get-Date" }), null);
  assert.equal(postconditionOf("run_command", null), null);
  assert.equal(postconditionOf("stop_process", { pid: 4 }, { exists: () => { throw new Error("disco"); }, isDirectory: () => true, size: () => 0 }), null);
  assert.equal(postconditionOf("herramienta_inventada", { path: path.join(os.tmpdir(), "x") }), null);
});

test("codeAnswersOk: solo lecturas deterministas con estado ok y contenido", () => {
  assert.ok(codeAnswersOk("system_info", "ok", "pid 4 · node"));
  assert.ok(codeAnswersOk("list_folder", "ok", "[DIR] a\n[FILE] b.txt"));
  assert.ok(codeAnswersOk("read_file", "ok", "1 | linea"));
  assert.ok(!codeAnswersOk("find_files", "ok", "[FILE] a.txt"), "una búsqueda la juzga el modelo");
  assert.ok(!codeAnswersOk("system_info", "ok", "   "));
  assert.ok(!codeAnswersOk("system_info", "ok", null));
  assert.ok(!codeAnswersOk("system_info", "no_data", "x"));
  assert.ok(!codeAnswersOk("web_search", "ok", "status: partial"), "un extracto de buscador lo juzga el modelo");
  assert.ok(!codeAnswersOk("run_command", "ok", "status: ok · exit code: 0"), "la salida de un comando la juzga el modelo");
});
