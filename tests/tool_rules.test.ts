/**
 * Reglas de política de las tools nativas (`policy/toolRules.ts`) y su efecto en Guard y en la lista de reglas integradas: la misma clasificación que su comando equivalente.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { blacklistMatch, EMPTY_BLACKLIST } from "../src/core/policy/blacklist.ts";
import { Guard } from "../src/core/policy/guard.ts";
import { classifyToolCall } from "../src/core/policy/toolRules.ts";
import { getToolPolicy } from "../src/core/tools/manifest.ts";

const BS = String.fromCharCode(92);
const win = (...parts: string[]): string => parts.join(BS);
const HOME = win("C:", "Users", "Ana");
const HOMES = ["c:/users/ana"];
const rule = (tool: string, args: Record<string, unknown>) => classifyToolCall(tool, args, HOMES);

test("power: apagar y reiniciar son blocked (igual que `shutdown`); bloquear y suspender no tienen regla", () => {
  assert.equal(rule("power", { action: "shutdown" })?.tier, "blocked");
  assert.equal(rule("power", { action: "restart", delaySec: 30 })?.tier, "blocked");
  assert.equal(rule("power", { action: "lock" }), null);
  assert.equal(rule("power", { action: "sleep" }), null);
});

test("delete_file: la raíz de un disco y la carpeta de Windows son guard; el sistema y las carpetas personales enteras, blocked; un archivo común no tiene regla", () => {
  assert.equal(rule("delete_file", { path: "C:" + BS })?.tier, "guard");
  assert.equal(rule("delete_file", { path: win("C:", "Windows") })?.tier, "guard");
  assert.equal(rule("delete_file", { path: win("C:", "Program Files", "App") })?.tier, "blocked");
  assert.equal(rule("delete_file", { path: HOME })?.tier, "blocked");
  assert.equal(rule("delete_file", { path: win(HOME, "Documents") })?.tier, "blocked");
  for (const alias of ["home", "desktop", "documents", "downloads", "~", "Documents" + BS]) assert.equal(rule("delete_file", { path: alias })?.tier, "blocked", alias);
  assert.equal(rule("delete_file", { path: win(HOME, "Documents", "viejo.txt") }), null);
  assert.equal(rule("delete_file", { path: win(HOME, "Documents", "Proyecto", "build") }), null);
  assert.equal(rule("delete_file", {}), null);
});

test("download_file: un ejecutable o un script, por la URL, el nombre o el destino, es sensitive; un archivo común no", () => {
  assert.equal(rule("download_file", { url: "https://x.test/setup.exe" })?.tier, "sensitive");
  assert.equal(rule("download_file", { url: "https://x.test/setup.msi?token=1" })?.tier, "sensitive");
  assert.equal(rule("download_file", { url: "https://x.test/get", filename: "instalar.ps1" })?.tier, "sensitive");
  assert.equal(rule("download_file", { url: "https://x.test/get", destination: win(HOME, "Downloads", "a.BAT") })?.tier, "sensitive");
  assert.equal(rule("download_file", { url: "https://x.test/foto.png" }), null);
  assert.equal(rule("download_file", { url: "https://x.test/informe.pdf", folder: "downloads" }), null);
});

test("escribir, copiar, mover y convertir: dejar un script o un ejecutable es sensitive, también dentro de un lote; extraer un zip no se juzga", () => {
  assert.equal(rule("write_file", { path: win(HOME, "tarea.ps1"), content: "x" })?.tier, "sensitive");
  assert.equal(rule("edit_file", { path: win(HOME, "tarea.cmd"), oldText: "a", newText: "b" })?.tier, "sensitive");
  assert.equal(rule("copy_file", { source: win(HOME, "a.txt"), destination: win(HOME, "a.bat") })?.tier, "sensitive");
  assert.equal(rule("move_file", { items: [{ source: win(HOME, "a.txt"), destination: win(HOME, "b.txt") }, { source: win(HOME, "c.txt"), destination: win(HOME, "c.lnk") }] })?.tier, "sensitive");
  assert.equal(rule("convert_file", { source: win(HOME, "a.png"), format: "exe" })?.tier, "sensitive");
  assert.equal(rule("convert_file", { source: win(HOME, "a.png"), format: "webp" }), null);
  assert.equal(rule("archive_files", { action: "compress", sources: [win(HOME, "a")], destination: win(HOME, "todo.zip") }), null);
  assert.equal(rule("archive_files", { action: "extract", source: win(HOME, "a.zip"), destination: win(HOME, "salida") }), null);
  assert.equal(rule("write_file", { path: win(HOME, "nota.txt"), content: "x" }), null);
  assert.equal(rule("write_file", { path: win(HOME, "nota"), content: "x" }), null);
  assert.equal(rule("write_file", { path: win(HOME, ".gitignore"), content: "x" }), null, "un archivo oculto sin extensión no es un script");
});

test("las tools que no modifican y las que no tienen regla no se clasifican", () => {
  for (const tool of ["read_file", "list_folder", "find_files", "search_content", "system_info", "clipboard", "pc_settings", "play_media", "stop_process", "create_folder"]) {
    assert.equal(rule(tool, { path: win(HOME, "x.exe"), action: "shutdown" }), null, tool);
  }
});

test("Guard y lista de reglas: guard deniega; blocked y sensitive llegan a la lista aunque la configuración esté vacía", () => {
  assert.equal(Guard.evaluate("jarvis_files_write", "delete_file", { path: "C:" + BS }).decision, "DENY");
  assert.equal(Guard.evaluate("jarvis_files_write", "delete_file", { path: win(HOME, "Documents", "viejo.txt") }).decision, "APPROVAL");
  const hit = (mcp: string, tool: string, args: Record<string, unknown>) => blacklistMatch(EMPTY_BLACKLIST, mcp, tool, getToolPolicy(mcp, tool).mutates, args, HOMES);
  assert.equal(hit("jarvis_system", "power", { action: "shutdown" })?.level, "blocked");
  assert.equal(hit("jarvis_files_write", "delete_file", { path: "documents" })?.level, "blocked");
  assert.equal(hit("jarvis_web", "download_file", { url: "https://x.test/a.exe" })?.level, "sensitive");
  assert.equal(hit("jarvis_files_write", "write_file", { path: win(HOME, "a.ps1"), content: "x" })?.level, "sensitive");
  assert.equal(hit("jarvis_files_write", "write_file", { path: win(HOME, "a.txt"), content: "x" }), null);
  assert.equal(hit("jarvis_files_read", "read_file", { path: win(HOME, "a.exe") }), null, "las lecturas nunca se miran");
  const blocked = hit("jarvis_system", "power", { action: "restart" });
  assert.match(blocked?.reason ?? "", /Do not retry/);
});

test("la lista de la configuración sigue valiendo para las tools nativas y gana el nivel más grave", async () => {
  const { compileBlacklist } = await import("../src/core/policy/blacklist.ts");
  const list = compileBlacklist([{ tool: "jarvis_files_write:write_file", pattern: "secreto", reason: "no tocar", level: "blocked" }]);
  assert.equal(blacklistMatch(list, "jarvis_files_write", "write_file", true, { path: win(HOME, "secreto.txt"), content: "x" }, HOMES)?.level, "blocked");
  assert.equal(blacklistMatch(list, "jarvis_files_write", "write_file", true, { path: win(HOME, "secreto.ps1"), content: "x" }, HOMES)?.level, "blocked", "blocked gana a sensitive");
  assert.equal(blacklistMatch(list, "jarvis_files_write", "write_file", true, { path: win(HOME, "otro.txt"), content: "x" }, HOMES), null);
});
