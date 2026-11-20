/** Procesamiento de resultados MCP y resolución de referencias: la frontera entre lo que devuelve una herramienta y lo que la tarea registra. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import { schemaTypes } from "../src/core/utils.ts";
import { processResult } from "../src/core/result/processResult.ts";
import { toolResult } from "../src/core/tools/result.ts";
import type { MCPCallResult } from "../src/core/types.ts";

const DC = "desktop_commander";
const TERMINAL = "jarvis_terminal";
const WEB = "jarvis_web";
const text = (t: string, extra: Partial<MCPCallResult> = {}): MCPCallResult => ({ content: [{ type: "text", text: t }], ...extra });
/** Resultado de un proveedor nativo: `text` es lo que ve el modelo y `raw` el texto completo (por defecto, el mismo). */
const native = (data: Record<string, unknown>, shown: string, raw = shown, isError = false): MCPCallResult => toolResult({ text: shown, raw, data, isError });

// ───────────────────────── processResult ─────────────────────────

test("resultado normal: ok, con resumen y sin truncar", () => {
  const r = processResult(DC, "list_directory", text("[FILE] a.txt\n[DIR] fotos"), { path: "C:\\x" });
  assert.equal(r.status, "ok");
  assert.ok(r.summary?.includes("a.txt"));
  assert.equal(r.truncated, false);
});

test("[DENIED] o 'access denied' en un error es denied; en un resultado exitoso es solo un dato", () => {
  assert.equal(processResult(DC, "read_file", text("[DENIED] fuera de allowedDirectories", { isError: true }), {}).status, "denied");
  assert.equal(processResult(DC, "read_file", text("el archivo dice: access denied", {}), {}).status, "ok");
});

test("not_found: marcador al inicio, o error con 'not found' / ENOENT", () => {
  assert.equal(processResult(DC, "read_file", text("[NOT_FOUND] sin archivo"), {}).status, "not_found");
  assert.equal(processResult(DC, "read_file", text("ENOENT: no such file or directory", { isError: true }), {}).status, "not_found");
});

test("tool_error: error, success=false, tiempo agotado o código de salida distinto de 0", () => {
  assert.equal(processResult(DC, "read_file", text("falló", { isError: true }), {}).status, "tool_error");
  assert.equal(processResult(DC, "read_file", text("x", { success: false }), {}).status, "tool_error");
  assert.equal(processResult(DC, "read_file", text('{"exit_code": 2, "pid": 9}'), {}).status, "tool_error");
  assert.equal(processResult(TERMINAL, "run_command", native({ state: "finished", pid: 7, exitCode: 1 }, "boom"), {}).status, "tool_error", "un proceso nativo que termina con código distinto de 0");
});

test("no_data: una herramienta que no admite salida vacía y devuelve vacío", () => {
  assert.equal(processResult(DC, "read_file", text(""), {}).status, "no_data");
});

test("un resumen nunca supera el tope y marca truncated; el texto completo se conserva para la ref", () => {
  const big = "línea de datos\n".repeat(2000);
  const r = processResult(DC, "read_file", text(big), { path: "C:\\x\\grande.txt" });
  assert.ok((r.summary?.length ?? 0) <= BUDGET.summaryMax);
  assert.equal(r.truncated, true);
  assert.equal(r.fullText, big.trim());
});

test("resultado nativo: lo que ve el modelo, el texto completo aparte, el pid y el estado del proceso", () => {
  const running = processResult(TERMINAL, "run_command", native({ state: "running", pid: 4321, exitCode: null }, "status: running", "salida completa y larga"), { command: "x" });
  assert.deepEqual(running.process, { pid: "4321", active: true });
  assert.equal(running.status, "ok");
  assert.equal(running.summary, "status: running");
  assert.equal(running.fullText, "salida completa y larga", "lo que va a la ref es raw");
  assert.equal(running.truncated, true);

  const done = processResult(TERMINAL, "run_command", native({ state: "finished", pid: 4321, exitCode: 0 }, "listo"), { command: "x" });
  assert.deepEqual(done.process, { pid: "4321", active: false });
  assert.equal(done.status, "ok");
  assert.equal(done.truncated, false, "si raw es igual a text no hay ref");

  const unknown = processResult(TERMINAL, "run_command", native({ state: "unknown_pid", pid: 9 }, "no existe", "no existe", true), { pid: 9 });
  assert.equal(unknown.status, "tool_error");
  assert.deepEqual(unknown.process, { pid: "9", active: false }, "un pid que no existe da de baja el hecho process");
});

test("extractStructured usa data.truncated cuando está presente y mantiene la comparación de texto si falta (web_search)", () => {
  // Cabecera/notas delante de una salida corta: text !== raw, pero data.truncated=false evita crear una ref innecesaria.
  const shortCmd = processResult(
    TERMINAL,
    "run_command",
    native({ state: "finished", pid: 7, exitCode: 0, truncated: false }, "status: finished · exit code: 0\nThe command finished successfully.\nhola", "hola"),
    { command: "echo hola" },
  );
  assert.equal(shortCmd.truncated, false);
  assert.equal(shortCmd.fullText, "hola");

  const shortStop = processResult(
    TERMINAL,
    "stop_process",
    native({ state: "stopped", pid: 7, scope: "run_command", truncated: false }, "status: stopped · pid: 7\nUnread output:\nantes", "antes"),
    { pid: 7 },
  );
  assert.equal(shortStop.truncated, false);

  // Salida recortada explícitamente: sí genera ref con el texto completo.
  const longCmd = processResult(
    TERMINAL,
    "run_command",
    native({ state: "finished", pid: 7, exitCode: 0, truncated: true }, "status: finished\n[… omitidos …]", "salida completa real"),
    { command: "dir /s" },
  );
  assert.equal(longCmd.truncated, true);
  assert.equal(longCmd.fullText, "salida completa real");

  // Sin data.truncated (web_search): sigue comparando raw contra text.
  const webDiff = processResult(WEB, "web_search", native({ state: "found" }, "status: found\nresumen", "fuente completa"), { need: "algo" });
  assert.equal(webDiff.truncated, true);
  const webSame = processResult(WEB, "web_search", native({ state: "found" }, "status: found", "status: found"), { need: "algo" });
  assert.equal(webSame.truncated, false);
});

test("resultado nativo: waiting_input trae el prompt y no es un fallo; sin resultados es no_data", () => {
  const waiting = processResult(TERMINAL, "run_command", native({ state: "waiting_input", pid: 5, exitCode: null, prompt: "Continuar (s/n)?" }, "status: waiting_input"), { command: "x" });
  assert.equal(waiting.status, "waiting_input");
  assert.equal(waiting.prompt, "Continuar (s/n)?");
  assert.deepEqual(waiting.process, { pid: "5", active: true });

  assert.equal(processResult(WEB, "web_search", native({ state: "not_found" }, "status: not_found"), {}).status, "no_data");
  assert.equal(processResult(WEB, "web_search", native({ state: "no_results" }, "status: no_results"), {}).status, "no_data");
  assert.equal(processResult(WEB, "web_search", native({ state: "found" }, "status: found"), {}).status, "ok");
});

test("un resultado de error nunca usa un extractor específico (no hay resumen de éxito de algo que falló)", () => {
  const r = processResult(DC, "list_directory", text("EPERM: operation not permitted", { isError: true }), {});
  assert.equal(r.status, "tool_error");
  assert.ok(r.summary?.includes("EPERM"));
});

test("los bloques que no son texto no aportan contenido", () => {
  const r = processResult(DC, "read_file", { content: [{ type: "image", data: "AAA", mimeType: "image/png" } as never, { type: "text", text: "hola" }] }, {});
  assert.equal(r.fullText, "hola");
});

test("schemaTypes: incluye las ramas anyOf/oneOf", () => {
  assert.deepEqual([...schemaTypes({ anyOf: [{ type: "string" }, { type: ["object", "null"] }] })].sort(), ["null", "object", "string"]);
});