/** Traza por tarea: se toma al terminar y se escribe en segundo plano, una sola vez, sin retener en memoria los prompts y resultados crudos. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { JarvisConfig } from "../src/core/config.ts";
import { TaskTraceRecorder } from "../src/core/trace/recorder.ts";
import { buildContext, newContext } from "./fixtures.ts";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-trace-"));
  const config = (): JarvisConfig => ({ traceEnabled: true, tracePath: path.join(root, "traces.jsonl"), qwenModel: "q", decisionModel: "d" }) as JarvisConfig;
  const recorder = new TaskTraceRecorder(buildContext("reactive", "closed"), config);
  return { root, traces: path.join(root, "traces"), recorder, held: recorder as unknown as { models: unknown[]; tools: unknown[]; waits: unknown[]; rawResults: Map<unknown, unknown> } };
}

const lines = (file: string): string[] => fs.readFileSync(file, "utf8").split("\n").filter(Boolean);

test("finish toma lo reunido al instante, libera la memoria y escribe la carpeta y su línea en index.jsonl al esperar la promesa", async () => {
  const { root, traces, recorder, held } = setup();
  recorder.sink.tool({ mcp: "desktop_commander", tool: "read_file", args: { path: "C:\\x" }, startedAt: 1, durationMs: 2, result: { content: [{ type: "text", text: "x".repeat(5000) }] }, error: null });
  recorder.sink.llm({ stage: "args", n: 1, startedAt: 1, durationMs: 2, input: "prompt largo", output: "respuesta", error: null });
  assert.ok(held.tools.length + held.models.length > 0, "antes de terminar, lo crudo está en memoria");

  const done = recorder.finish();
  assert.equal(held.models.length + held.tools.length + held.waits.length + held.rawResults.size, 0, "al terminar, nada crudo queda retenido (aunque la escritura siga)");

  await done;
  const folders = fs.readdirSync(traces).filter((n) => n !== "index.jsonl");
  assert.equal(folders.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(traces, folders[0])).sort(), ["full.json.gz", "summary.md", "trace.json"]);
  assert.equal(lines(path.join(traces, "index.jsonl")).length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("finish es idempotente: devuelve la misma promesa y no duplica la traza", async () => {
  const { root, traces, recorder } = setup();
  const first = recorder.finish();
  assert.equal(recorder.finish(), first);
  await first;
  await recorder.finish();
  assert.equal(lines(path.join(traces, "index.jsonl")).length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("el resultado crudo se serializa al escribir: se registra su largo y, si falló la herramienta, queda en null", async () => {
  const { root, traces, recorder } = setup();
  const big = { content: [{ type: "text", text: "y".repeat(30_000) }] };
  recorder.sink.tool({ mcp: "desktop_commander", tool: "read_file", args: {}, startedAt: 1, durationMs: 1, result: big, error: null });
  recorder.sink.tool({ mcp: "desktop_commander", tool: "list_directory", args: {}, startedAt: 2, durationMs: 1, result: null, error: "boom" });
  await recorder.finish();

  const folder = fs.readdirSync(traces).find((n) => n !== "index.jsonl")!;
  const trace = JSON.parse(fs.readFileSync(path.join(traces, folder, "trace.json"), "utf8")) as { tools: { tool: string; resultChars: number | null; resultFragment?: string | null }[] };
  const read = trace.tools.find((t) => t.tool === "read_file")!;
  assert.equal(read.resultChars, JSON.stringify(big).length);
  const failed = trace.tools.find((t) => t.tool === "list_directory")!;
  assert.equal(failed.resultChars, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("con la traza desactivada no escribe nada y finish igual resuelve", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-trace-off-"));
  const config = (): JarvisConfig => ({ traceEnabled: false, tracePath: path.join(root, "traces.jsonl") }) as JarvisConfig;
  const recorder = new TaskTraceRecorder(buildContext("reactive", "closed"), config);
  await recorder.finish();
  assert.deepEqual(fs.readdirSync(root), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("un fallo al escribir (la ruta de las trazas es un archivo) no rechaza la promesa ni afecta a la tarea", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-trace-bad-"));
  fs.writeFileSync(path.join(root, "traces"), "soy un archivo, no una carpeta");
  const config = (): JarvisConfig => ({ traceEnabled: true, tracePath: path.join(root, "traces.jsonl"), qwenModel: "q", decisionModel: "d" }) as JarvisConfig;
  const recorder = new TaskTraceRecorder(buildContext("reactive", "closed"), config);
  await assert.doesNotReject(recorder.finish());
  fs.rmSync(root, { recursive: true, force: true });
});

test("con ref, la traza guarda la referencia y no el texto del resultado, pero registra su largo", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-trace-ref-"));
  const config = (): JarvisConfig => ({ traceEnabled: true, tracePath: path.join(root, "traces.jsonl"), qwenModel: "q", decisionModel: "d" }) as JarvisConfig;
  const ctx = newContext("reactive");
  const recorder = new TaskTraceRecorder(ctx, config);
  const big = { content: [{ type: "text", text: "z".repeat(30_000) }] };
  recorder.sink.tool({ mcp: "desktop_commander", tool: "read_file", args: {}, startedAt: 1, durationMs: 1, result: big, error: null });

  const step = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "Leer", route: null, expected: null } }).ids[0];
  const ref = ctx.apply({ op: "add", target: "refs", value: { stepId: step, label: "read_file", size: 30000, where: path.join(root, "r1.txt") } }).ids[0];
  ctx.apply({ op: "add", target: "calls", value: { stepId: step, route: "files", tool: "read_file", kind: "read", args: {}, sig: "s", status: "ok", summary: "resumen", ref } });
  await recorder.finish();

  const traces = path.join(root, "traces");
  const folder = fs.readdirSync(traces).find((n) => n !== "index.jsonl")!;
  const trace = JSON.parse(fs.readFileSync(path.join(traces, folder, "trace.json"), "utf8")) as { tools: { ref: string | null; resultChars: number | null; resultHead: string | null }[] };
  assert.equal(trace.tools[0].ref, ref);
  assert.equal(trace.tools[0].resultHead, null);
  assert.equal(trace.tools[0].resultChars, JSON.stringify(big).length);
  fs.rmSync(root, { recursive: true, force: true });
});
