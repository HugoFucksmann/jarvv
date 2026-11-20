/** Seguridad: el Guard y las reglas de comando son deterministas y ningún modelo las puede saltear. */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { Guard, isPathInside } from "../src/core/policy/guard.ts";
import type { ProtectedPaths } from "../src/core/policy/guard.ts";
import { blacklistMatch, compileBlacklist } from "../src/core/policy/blacklist.ts";
import { classify } from "../src/core/policy/commandRules.ts";
import { SYSTEM_TOOL_MANIFEST } from "../src/core/tools/manifest.ts";
import os from "node:os";
import type { JarvisConfig } from "../src/core/config.ts";
import { createEngineServices } from "../src/core/engine/services.ts";

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

test("fail-closed: una herramienta que no está en el catálogo pide aprobación, y toda herramienta del catálogo que modifica también la pide", () => {
  const unknown = Guard.evaluate(DC, "herramienta_nueva", { path: "C:/x/a.txt" });
  assert.equal(unknown.decision, "APPROVAL");
  assert.notEqual(unknown.mandatory, true);
  for (const t of SYSTEM_TOOL_MANIFEST) {
    if (t.policy.mutates) assert.equal(t.policy.requiresApproval, true, `${t.server}:${t.name} modifica y no pide aprobación`);
  }
});

// ───────────────────────── Invariante 8: memoria, log y proyecto protegidos ─────────────────────────

const PROJECT = path.resolve("proyecto-prueba");
const DATA = path.join(PROJECT, "data");
const REFS = path.join(DATA, "refs");
const TASKS = path.join(DATA, "tasks");
const MEMORY = path.join(DATA, "memory.json");
const HOME = path.resolve("home-prueba");
const TERMINAL = "jarvis_terminal";
/** Memoria, refs y logs, sin la carpeta del proyecto: cada protección se prueba por sí sola. */
const dataScope: ProtectedPaths = { protectedDirs: [REFS, TASKS], protectedFiles: [MEMORY], relativeBases: [DATA], commandBases: [HOME] };
/** Con la carpeta del proyecto, como la compone `createEngineServices`. */
const projectScope: ProtectedPaths = { protectedDirs: [REFS, TASKS, PROJECT], protectedFiles: [MEMORY], relativeBases: [PROJECT], commandBases: [HOME] };
const run = (command: string, scope: ProtectedPaths = dataScope, extra: Record<string, unknown> = {}) => Guard.evaluate(TERMINAL, "run_command", { command, ...extra }, scope);

test("invariante 8: las herramientas de archivos no pueden escribir en data/memory.json ni en el log; la denegación no se puede aprobar", () => {
  const tools: [string, Record<string, unknown>][] = [
    ["write_file", { path: MEMORY, content: "x" }],
    ["write_file", { path: path.join(TASKS, "task_1_a.jsonl"), content: "x", mode: "append" }],
    ["write_file", { path: path.join(REFS, "task_1", "r1.txt"), content: "x" }],
    ["write_file", { path: "memory.json", content: "x" }],
    ["create_directory", { path: path.join(TASKS, "nueva") }],
    ["move_file", { source: path.join(HOME, "a.txt"), destination: MEMORY }],
    ["move_file", { source: MEMORY, destination: path.join(HOME, "copia.json") }],
  ];
  for (const [tool, args] of tools) {
    const decision = Guard.evaluate(DC, tool, args, dataScope);
    assert.equal(decision.decision, "DENY", `${tool} ${JSON.stringify(args)}`);
    assert.notEqual(decision.mandatory, true, "es un DENY, no una aprobación obligatoria: el usuario no puede aceptarlo");
  }
});

test("invariante 8: leer la memoria y el log sigue permitido, y lo que está al lado no se protege", () => {
  assert.equal(Guard.evaluate(DC, "read_file", { path: MEMORY }, dataScope).decision, "ALLOW");
  assert.equal(Guard.evaluate(DC, "list_directory", { path: TASKS }, dataScope).decision, "ALLOW");
  assert.notEqual(Guard.evaluate(DC, "write_file", { path: path.join(DATA, "memory.json.bak"), content: "x" }, dataScope).decision, "DENY", "solo el archivo exacto");
  assert.notEqual(Guard.evaluate(DC, "write_file", { path: path.join(DATA, "otro.txt"), content: "x" }, dataScope).decision, "DENY");
  assert.notEqual(Guard.evaluate(DC, "write_file", { path: path.join(HOME, "memory.json"), content: "x" }, dataScope).decision, "DENY", "otro archivo con el mismo nombre en otra carpeta");
});

test("invariante 8: dentro de la carpeta del proyecto de Jarvis no se escribe, con ruta absoluta o relativa; afuera sí se pide aprobación", () => {
  assert.equal(Guard.evaluate(DC, "write_file", { path: path.join(PROJECT, "src", "core", "guard.ts"), content: "x" }, projectScope).decision, "DENY");
  assert.equal(Guard.evaluate(DC, "write_file", { path: path.join("src", "core", "guard.ts"), content: "x" }, projectScope).decision, "DENY");
  assert.equal(Guard.evaluate(DC, "create_directory", { path: path.join(PROJECT, "nueva") }, projectScope).decision, "DENY");
  assert.equal(Guard.evaluate(DC, "write_file", { path: path.join(HOME, "notas.txt"), content: "x" }, projectScope).decision, "APPROVAL");
  assert.equal(Guard.evaluate(DC, "read_file", { path: path.join(PROJECT, "readme.md") }, projectScope).decision, "ALLOW", "leer el proyecto sigue permitido");
});

test("invariante 8 en run_command: un comando que escribe en la memoria, el log o el proyecto se deniega", () => {
  const writes = [
    `Set-Content ${MEMORY} "x"`,
    `Add-Content '${MEMORY}' 'x'`,
    `Remove-Item ${path.join(TASKS, "task_1_a.jsonl")}`,
    `Remove-Item -Recurse -Force ${REFS}`,
    `echo x > ${MEMORY}`,
    `echo x >> "${MEMORY}"`,
    `Move-Item ${MEMORY} ${path.join(HOME, "copia.json")}`,
    `powershell -Command "Remove-Item ${MEMORY}"`,
    `cmd /c del ${MEMORY}`,
    `Get-Date; Set-Content ${MEMORY} x`,
  ];
  for (const command of writes) assert.equal(run(command).decision, "DENY", command);
  assert.equal(run("Set-Content memory.json x", dataScope, { cwd: DATA }).decision, "DENY", "ruta relativa resuelta contra el cwd del comando");
  assert.equal(run("npm install", projectScope, { cwd: PROJECT }).decision, "DENY", "un comando que modifica, con la carpeta de trabajo en el proyecto");
  assert.equal(run(`Set-Content ${path.join(PROJECT, "src", "a.ts")} x`, projectScope).decision, "DENY");
});

test("invariante 8 en run_command: leer sigue permitido y lo que no toca lo protegido no se deniega", () => {
  assert.notEqual(run(`Get-Content ${MEMORY}`).decision, "DENY", "un comando de solo lectura");
  assert.notEqual(run(`Get-ChildItem ${TASKS}`).decision, "DENY");
  assert.notEqual(run(`Set-Content ${path.join(HOME, "notas.txt")} x`, projectScope).decision, "DENY", "escribir en otra carpeta es asunto de la aprobación, no del DENY");
  assert.notEqual(run(`Set-Content ${path.join(DATA, "otro.txt")} x`).decision, "DENY");
  assert.notEqual(run("Get-Date").decision, "DENY");
});

test("createEngineServices: el alcance del Guard cubre refs, logs, proyecto y el memory.json de la carpeta de datos", () => {
  const root = path.resolve("datos-prueba");
  const config = { refsDir: path.join(root, "refs"), tracePath: path.join(root, "traces.jsonl"), desktopCommanderMcp: { command: "x", args: [] }, blacklist: [] } as unknown as JarvisConfig;
  const { guardScope } = createEngineServices(() => config);
  assert.deepEqual(guardScope.protectedDirs, [path.join(root, "refs"), path.join(root, "tasks"), process.cwd()]);
  assert.deepEqual(guardScope.protectedFiles, [path.join(root, "memory.json")]);
  assert.deepEqual(guardScope.commandBases, [os.homedir()]);
  assert.ok(guardScope.relativeBases.includes(process.cwd()));
});
