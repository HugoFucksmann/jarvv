/** Traza por tarea: se escribe una vez y, después, no retiene en memoria los prompts y resultados crudos. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { JarvisConfig } from "../src/core/config.ts";
import { TaskTraceRecorder } from "../src/core/trace/recorder.ts";
import { buildContext } from "./fixtures.ts";

test("finish escribe la carpeta de la traza y su línea en index.jsonl, y libera lo crudo que tenía en memoria", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-trace-"));
  const config = (): JarvisConfig =>
    ({ traceEnabled: true, tracePath: path.join(root, "traces.jsonl"), qwenModel: "q", decisionModel: "d" }) as JarvisConfig;
  const ctx = buildContext("reactive", "closed");
  const recorder = new TaskTraceRecorder(ctx, config);

  recorder.sink.tool({ mcp: "desktop_commander", tool: "read_file", args: { path: "C:\\x" }, startedAt: 1, durationMs: 2, result: { content: [{ type: "text", text: "x".repeat(5000) }] }, error: null });
  recorder.sink.llm({ stage: "args", n: 1, startedAt: 1, durationMs: 2, input: "prompt largo", output: "respuesta", error: null });
  const held = recorder as unknown as { models: unknown[]; tools: unknown[]; waits: unknown[] };
  assert.ok(held.tools.length + held.models.length > 0, "antes de terminar, lo crudo está en memoria");

  recorder.finish();
  const traces = path.join(root, "traces");
  const folders = fs.readdirSync(traces).filter((n) => n !== "index.jsonl");
  assert.equal(folders.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(traces, folders[0])).sort(), ["full.json.gz", "summary.md", "trace.json"]);
  assert.equal(fs.readFileSync(path.join(traces, "index.jsonl"), "utf8").split("\n").filter(Boolean).length, 1);
  assert.equal(held.models.length + held.tools.length + held.waits.length, 0, "después de terminar, nada crudo queda retenido");

  recorder.finish();
  assert.equal(fs.readFileSync(path.join(traces, "index.jsonl"), "utf8").split("\n").filter(Boolean).length, 1, "terminar dos veces no duplica");
  fs.rmSync(root, { recursive: true, force: true });
});
