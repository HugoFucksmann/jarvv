import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { classify } from "../src/core/policy/commandRules.ts";
import { checkAllowedDirectory } from "../src/core/policy/allowedDirs.ts";
import { egressFinding } from "../src/core/policy/egress.ts";
import { isLoopbackHost } from "../src/server/localOnly.ts";

test("HOST: solo loopback", () => {
  for (const h of ["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"]) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ["0.0.0.0", "192.168.1.5", "::", "example.com", ""]) assert.equal(isLoopbackHost(h), false, h);
});

test("egress: un SHA hex de git no es una clave; una cadena alfanumérica larga que no es hex sí", () => {
  const find = (need: string) => egressFinding("jarvis_web", "web_search", { need })?.id ?? null;
  assert.equal(find(`qué cambió en el commit ${"a1b2c3d4e5".repeat(4)}`), null);
  assert.equal(find(`qué cambió en ${"a1b2c3d4e5f6g7h8i9".repeat(3)}`), "long-blob");
});

test("commandRules: llamadas .NET no estáticas (.Delete()) piden revisión", () => {
  assert.equal(classify("(Get-Item C:\\x\\a.txt).Delete()")?.tier, "sensitive");
  assert.equal(classify("$f = Get-Item a.txt; $f.Delete()")?.tier, "sensitive");
  assert.equal(classify("Get-ChildItem C:\\x"), null);
});

test("allowedDirectories: dentro, fuera y no resoluble (con realpath)", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-allowed-")));
  try {
    const dirs = [base];
    assert.equal(checkAllowedDirectory(path.join(base, "sub", "nuevo.txt"), dirs).allowed, true);
    const outside = checkAllowedDirectory(path.join(path.dirname(base), "otra-carpeta", "x.txt"), dirs);
    assert.equal(outside.allowed, false);
    assert.equal(!outside.allowed && outside.reason, "outside");
    const rel = checkAllowedDirectory("relativa.txt", dirs);
    assert.equal(!rel.allowed && rel.reason, "unresolvable", "ruta relativa sin cwd");
    assert.equal(checkAllowedDirectory("relativa.txt", dirs, { cwdBase: base }).allowed, true);
    const env = checkAllowedDirectory("$env:TEMP\\x", dirs);
    assert.equal(!env.allowed && env.reason, "unresolvable");
    assert.equal(checkAllowedDirectory("C:\\cualquier\\cosa", []).allowed, true, "lista vacía: sin restricción");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ───────────────────────── Aprobación una vez / siempre en la tarea ─────────────────────────

import { approvalKey } from "../src/core/policy/approvalKey.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import { uncoveredArtifacts } from "../src/core/engine/completion.ts";

const BS = String.fromCharCode(92);

test("approvalKey: comando normalizado, ruta normalizada y el resto por argumentos", () => {
  assert.equal(approvalKey("run_command", { command: "  Get-Process   node " }), approvalKey("run_command", { command: "get-process node" }));
  assert.notEqual(approvalKey("run_command", { command: "a" }), approvalKey("stop_process", { command: "a" }));
  assert.equal(
    approvalKey("write_file", { path: `C:${BS}Temp${BS}A.txt`, content: "uno" }),
    approvalKey("write_file", { path: "c:/temp//a.txt", content: "otro" }),
    "mismo archivo, distinto contenido",
  );
  assert.notEqual(approvalKey("write_file", { path: "c:/temp/a.txt" }), approvalKey("write_file", { path: "c:/temp/b.txt" }));
  assert.equal(approvalKey("web_search", { b: 1, a: 2 }), approvalKey("web_search", { a: 2, b: 1 }));
});

test("TaskRuntime: «siempre» solo se recuerda si la solicitud lo ofrecía; lo obligatorio solo admite una vez", async () => {
  const base = { mcp: "m", tool: "t", capability: "FILE_WRITE" as const, reason: "r", args: {} };
  for (const [canRemember, expected] of [[true, true], [false, undefined], [undefined, undefined]] as const) {
    const rt = new TaskRuntime();
    const pending = rt.requestApproval({ ...base, ...(canRemember === undefined ? {} : { canRemember }) });
    const id = rt.waiting!.kind === "approval" ? rt.waiting!.request.id : "";
    assert.equal(rt.resolveApproval(id, true, undefined, true), true);
    const outcome = await pending;
    assert.equal(outcome.kind, "approved");
    assert.equal(outcome.kind === "approved" ? outcome.remember : null, expected);
  }
  const rt = new TaskRuntime();
  rt.rememberApproval("k");
  rt.rememberRejection("j");
  assert.equal(rt.isAlwaysApproved("k"), true);
  assert.equal(rt.isAlwaysApproved("j"), false);
  assert.equal(rt.wasRejectedByUser("j"), true);
  assert.equal(new TaskRuntime().isAlwaysApproved("k"), false, "otra tarea: nada recordado");
});

test("D5 guarda de cobertura: un archivo nombrado en el pedido que ninguna llamada menciona", () => {
  const calls = [{ args: { path: `C:${BS}x${BS}jarvis` }, summary: "ok" }];
  assert.deepEqual(uncoveredArtifacts("Crear la carpeta jarvis y el archivo gpt_info.md", calls), ["gpt_info.md"]);
  assert.deepEqual(uncoveredArtifacts("Crear gpt_info.md", [...calls, { args: { path: `C:${BS}x${BS}jarvis${BS}GPT_INFO.md` }, summary: null }]), []);
  assert.deepEqual(uncoveredArtifacts("Busca en github.com la versión v1.2", calls), [], "dominios y versiones no son archivos");
  assert.deepEqual(uncoveredArtifacts("hola", []), []);
});

test("terminal: tablas propias de las páginas 852 y 857", async () => {
  const { codePageDecoder, accentScore } = await import("../src/tools/terminal/output.ts");
  assert.equal(codePageDecoder(852)?.(Uint8Array.of(0x88, 0xa9)), "łę", "852: 0x88 = ł, 0xA9 = ę");
  assert.equal(codePageDecoder(857)?.(Uint8Array.of(0x8d, 0x9f)), "ış", "857: 0x8D = ı, 0x9F = ş");
  assert.ok(accentScore("łęż") > 0, "Latin Extended-A cuenta como letra acentuada");
});
