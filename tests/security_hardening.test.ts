/**
 * Endurecimiento de políticas: enlaces hacia carpetas protegidas (Guard), segmentos `..` y comillas tipográficas en las reglas de comandos.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { classify } from "../src/core/policy/commandRules.ts";
import { Guard } from "../src/core/policy/guard.ts";
import { isReadOnlyCommand } from "../src/core/policy/readOnly.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-sec-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

test("Guard: un enlace hacia una carpeta protegida no esquiva el invariante 8", (t) => {
  const protectedDir = path.join(root, "protegida");
  const work = path.join(root, "trabajo");
  fs.mkdirSync(protectedDir);
  fs.mkdirSync(work);
  const link = path.join(work, "atajo");
  try {
    fs.symlinkSync(protectedDir, link, process.platform === "win32" ? "junction" : "dir");
  } catch {
    t.skip("el sistema no permite crear enlaces");
    return;
  }
  const scope = { protectedDirs: [protectedDir], relativeBases: [work] };
  const viaLink = Guard.evaluate("jarvis_files_write", "write_file", { path: path.join(link, "nuevo.txt"), content: "x" }, scope);
  assert.equal(viaLink.decision, "DENY");
  const outside = Guard.evaluate("jarvis_files_write", "write_file", { path: path.join(work, "nuevo.txt"), content: "x" }, scope);
  assert.notEqual(outside.decision, "DENY");
});

test("commandRules: los segmentos `..` no esconden una carpeta crítica", () => {
  const direct = classify("Remove-Item -Recurse C:\\Users");
  const viaDots = classify("Remove-Item -Recurse C:\\Users\\ana\\Desktop\\..\\..");
  assert.ok(direct);
  assert.ok(viaDots);
  assert.equal(viaDots.tier, direct.tier);
});

test("commandRules: las comillas tipográficas cuentan como comillas", () => {
  const plain = classify("Remove-Item -Recurse 'C:\\Windows'");
  const curly = classify("Remove-Item -Recurse \u2018C:\\Windows\u2019");
  assert.ok(plain);
  assert.ok(curly);
  assert.equal(curly.tier, plain.tier);
});

test("readOnly: unas comillas tipográficas no esconden un separador de comandos", () => {
  assert.equal(isReadOnlyCommand("echo \u201Chola; Remove-Item x\u201D"), isReadOnlyCommand('echo "hola; Remove-Item x"'));
});
