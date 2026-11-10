/** Seguridad: el Guard y las reglas de comando son deterministas y ningún modelo las puede saltear. */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { Guard, isPathInside } from "../src/core/policy/guard.ts";
import type { ProtectedPaths } from "../src/core/policy/guard.ts";
import { blacklistMatch, compileBlacklist } from "../src/core/policy/blacklist.ts";
import { classify } from "../src/core/policy/commandRules.ts";

const DC = "desktop_commander";
const scope: ProtectedPaths = { protectedDirs: [path.resolve("data/refs")], relativeBases: [process.cwd()] };

test("Guard: una lectura se permite y una escritura pide aprobación", () => {
  assert.equal(Guard.evaluate(DC, "read_file", { path: "C:\\Users\\Ana\\a.txt" }).decision, "ALLOW");
  assert.equal(Guard.evaluate(DC, "write_file", { path: "C:\\Users\\Ana\\a.txt", content: "x" }).decision, "APPROVAL");
});

test("Guard: una herramienta fuera del manifest pide aprobación (fail-closed)", () => {
  assert.equal(Guard.evaluate(DC, "herramienta_inventada", {}).decision, "APPROVAL");
});

test("Guard: comandos catastróficos se deniegan siempre", () => {
  for (const command of ["format c:", "rm -rf /", "Remove-Item -Recurse -Force C:\\", "mkfs.ext4 /dev/sda1"]) {
    assert.equal(Guard.evaluate(DC, "start_process", { command }).decision, "DENY", command);
  }
});

test("Guard: un borrado acotado no es catastrófico", () => {
  assert.notEqual(Guard.evaluate(DC, "start_process", { command: "rm -rf /tmp/x" }).decision, "DENY");
});

test("Guard (regla B): escribir dentro de la carpeta de refs se deniega, con ruta absoluta o relativa", () => {
  const absolute = path.resolve("data/refs/task_1/r1.txt");
  assert.equal(Guard.evaluate(DC, "write_file", { path: absolute, content: "x" }, scope).decision, "DENY");
  assert.equal(Guard.evaluate(DC, "write_file", { path: "data/refs/task_1/r1.txt", content: "x" }, scope).decision, "DENY");
  assert.notEqual(Guard.evaluate(DC, "write_file", { path: "data/otra/a.txt", content: "x" }, scope).decision, "DENY");
});

test("Guard (regla B): leer las refs sigue permitido", () => {
  assert.equal(Guard.evaluate(DC, "read_file", { path: path.resolve("data/refs/task_1/r1.txt") }, scope).decision, "ALLOW");
});

test("isPathInside: una carpeta con nombre '..x' está dentro y '..' está fuera", () => {
  assert.equal(isPathInside("/a/b", "/a/b/..backup/c"), true);
  assert.equal(isPathInside("/a/b", "/a/b"), true);
  assert.equal(isPathInside("/a/b", "/a/c"), false);
  assert.equal(isPathInside("/a/b", "/a/b/../c"), false);
});

test("commandRules: clasifica por comando y ruta, no por texto suelto", () => {
  assert.equal(classify("rm -rf /")?.tier, "guard");
  assert.equal(classify("echo hola"), null);
});

test("lista negra: una entrada con patrón solo coincide con sus argumentos y solo en escrituras", () => {
  const list = compileBlacklist([{ tool: "start_process", pattern: "shutdown", reason: "no apagar" }]);
  assert.ok(blacklistMatch(list, DC, "start_process", true, { command: "shutdown /s" }));
  assert.equal(blacklistMatch(list, DC, "start_process", true, { command: "dir" }), null);
  assert.equal(blacklistMatch(list, DC, "read_file", false, { command: "shutdown /s" }), null);
});
