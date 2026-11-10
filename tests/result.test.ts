/** Procesamiento de resultados MCP y resolución de referencias: la frontera entre lo que devuelve una herramienta y lo que la tarea registra. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import { createRefLookup, isWholeRefToken, resolveRefs, schemaTypes } from "../src/core/refs/refResolver.ts";
import type { RefLookup } from "../src/core/refs/refResolver.ts";
import { processResult } from "../src/core/result/processResult.ts";
import type { MCPCallResult } from "../src/core/types.ts";

const DC = "desktop_commander";
const text = (t: string, extra: Partial<MCPCallResult> = {}): MCPCallResult => ({ content: [{ type: "text", text: t }], ...extra });

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
  assert.equal(processResult(DC, "start_process", text('{"exit_code": 2, "pid": 9}'), {}).status, "tool_error");
  assert.equal(processResult(DC, "start_process", text("Process started with PID 7\nboom\nProcess completed with exit code 1 (runtime: 1s)"), {}).status, "tool_error");
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

test("start_process: señal de proceso activo con el pid; con 'finished' queda inactivo", () => {
  const active = processResult(DC, "start_process", text("Process started with PID 4321 (shell: powershell)\nesperando..."), { command: "x" });
  assert.deepEqual(active.process, { pid: "4321", active: true });
  const done = processResult(DC, "start_process", text("Process started with PID 4321 (shell: powershell)\nlisto\n✅ Process 4321 has finished execution"), { command: "x" });
  assert.deepEqual(done.process, { pid: "4321", active: false });
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

// ───────────────────────── refResolver ─────────────────────────

const lookup = (refs: Record<string, string>): RefLookup => ({ get: async (id) => refs[id] });

test("refs: el valor completo y la forma embebida se sustituyen; sin el prefijo `ref:` un r1 desnudo no es ref", async () => {
  const l = lookup({ r1: "CONTENIDO" });
  const out = await resolveRefs({ a: "{{ref:r1}}", b: "ref:r1", c: "antes {{ref:r1}} después", d: "r1" }, l);
  assert.deepEqual(out.resolvedArgs, { a: "CONTENIDO", b: "CONTENIDO", c: "antes CONTENIDO después", d: "r1" });
  assert.deepEqual(out.resolvedRefs, ["r1"]);
  assert.equal(out.unresolvedRefs.length, 0);
});

test("refs: una ref desconocida queda literal y se informa", async () => {
  const out = await resolveRefs({ a: "{{ref:r9}}", b: "x {{ref:r9}} y" }, lookup({}));
  assert.deepEqual(out.resolvedArgs, { a: "{{ref:r9}}", b: "x {{ref:r9}} y" });
  assert.deepEqual(out.unresolvedRefs, ["r9"]);
});

test("refs: el contenido sustituido no se vuelve a escanear (sin anidadas)", async () => {
  const out = await resolveRefs({ a: "{{ref:r1}}" }, lookup({ r1: "{{ref:r2}}", r2: "SECRETO" }));
  assert.equal(out.resolvedArgs.a, "{{ref:r2}}");
  assert.deepEqual(out.resolvedRefs, ["r1"]);
});

test("refs: se parsea el JSON de una ref solo si el schema pide objeto o arreglo y no admite string", async () => {
  const l = lookup({ r1: '{"k":1}' });
  const structured = await resolveRefs({ a: "{{ref:r1}}" }, l, { properties: { a: { type: "object" } } });
  assert.deepEqual(structured.resolvedArgs.a, { k: 1 });
  const mixed = await resolveRefs({ a: "{{ref:r1}}" }, l, { properties: { a: { anyOf: [{ type: "string" }, { type: "object" }] } } });
  assert.equal(mixed.resolvedArgs.a, '{"k":1}');
  const noSchema = await resolveRefs({ a: "{{ref:r1}}" }, l);
  assert.equal(noSchema.resolvedArgs.a, '{"k":1}');
});

test("refs: se resuelven dentro de arreglos y objetos anidados", async () => {
  const out = await resolveRefs({ paths: ["{{ref:r1}}", "fijo"], deep: { x: "ref:r1" } }, lookup({ r1: "A" }));
  assert.deepEqual(out.resolvedArgs, { paths: ["A", "fijo"], deep: { x: "A" } });
});

test("refs: createRefLookup toma la ruta del contexto y un fallo de lectura da undefined", async () => {
  const source = { get: (id: string) => (id === "r1" ? ({ id: "r1", where: "data/refs/t/r1.txt", size: 1, label: "x", stepId: "s1" } as never) : undefined) };
  const ok = createRefLookup(source, { readAll: async (where) => `leído:${where}` });
  assert.equal(await ok.get("r1"), "leído:data/refs/t/r1.txt");
  assert.equal(await ok.get("r2"), undefined);
  const broken = createRefLookup(source, { readAll: async () => { throw new Error("EIO"); } });
  assert.equal(await broken.get("r1"), undefined);
});

test("refs: isWholeRefToken y schemaTypes", () => {
  assert.equal(isWholeRefToken("{{ref:r12}}"), true);
  assert.equal(isWholeRefToken(" ref:r3 "), true);
  assert.equal(isWholeRefToken("x {{ref:r1}}"), false);
  assert.deepEqual([...schemaTypes({ anyOf: [{ type: "string" }, { type: ["object", "null"] }] })].sort(), ["null", "object", "string"]);
});
