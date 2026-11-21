/** Tiempos de espera: los valores por defecto no cambiaron al centralizarlos y los overrides por herramienta y por modelo se resuelven en el orden documentado. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { timeoutMap } from "../src/core/config.ts";
import { FIXED_TIMEOUTS, resolveModelTimeoutMs, resolveToolTimeoutMs, TIMEOUT_DEFAULTS } from "../src/core/timeouts.ts";
import { timeoutOf } from "../src/core/tools/manifest.ts";

const base = { mcpTimeoutMs: 60_000, qwenTimeoutMs: 120_000, qwenThinkingTimeoutMs: 180_000, decisionTimeoutMs: 30_000 };

test("los valores por defecto son los que regían antes de centralizarlos", () => {
  assert.deepEqual(TIMEOUT_DEFAULTS, {
    mcpMs: 60_000, qwenMs: 120_000, qwenThinkingMs: 180_000, decisionMs: 30_000,
    runCommandDefaultWaitSec: 30, runCommandMaxWaitSec: 300, webJudgeMs: 20_000, sseKeepAliveMs: 15_000, shutdownDrainMs: 3_000,
  });
  assert.equal(FIXED_TIMEOUTS.analyzerMs, 8_000);
  assert.equal(FIXED_TIMEOUTS.spawnMs, 15_000);
  assert.equal(FIXED_TIMEOUTS.killMs, 5_000);
  assert.equal(FIXED_TIMEOUTS.promptIdleMs, 1_500);
  assert.equal(FIXED_TIMEOUTS.threadTtlMs, 600_000);
  assert.equal(FIXED_TIMEOUTS.retentionIntervalMs, 21_600_000);
  assert.equal(timeoutOf("jarvis_terminal", "run_command"), (TIMEOUT_DEFAULTS.runCommandMaxWaitSec + FIXED_TIMEOUTS.runCommandSlackSec) * 1000, "el plazo del catálogo sigue a la espera máxima");
  assert.equal(timeoutOf("jarvis_web", "web_search"), 150_000);
});

test("herramienta: `servidor:herramienta` gana sobre `herramienta`; sin override rige el catálogo (undefined)", () => {
  assert.equal(resolveToolTimeoutMs(base, "jarvis_files", "read_file"), undefined);
  const cfg = { ...base, toolTimeoutsMs: { read_file: 90_000, "jarvis_files:read_file": 120_000 } };
  assert.equal(resolveToolTimeoutMs(cfg, "jarvis_files", "read_file"), 120_000);
  assert.equal(resolveToolTimeoutMs(cfg, "otro", "read_file"), 90_000);
  assert.equal(resolveToolTimeoutMs(cfg, "jarvis_files", "list_directory"), undefined);
});

test("run_command: el plazo de la herramienta sigue a la espera máxima configurada, salvo un override explícito", () => {
  assert.equal(resolveToolTimeoutMs({ ...base, runCommandMaxWaitSec: 300 }, "jarvis_terminal", "run_command"), undefined, "con el valor por defecto rige el del catálogo (315 s)");
  assert.equal(resolveToolTimeoutMs({ ...base, runCommandMaxWaitSec: 600 }, "jarvis_terminal", "run_command"), 615_000);
  assert.equal(resolveToolTimeoutMs({ ...base, runCommandMaxWaitSec: 600, toolTimeoutsMs: { run_command: 200_000 } }, "jarvis_terminal", "run_command"), 200_000);
});

test("modelo: el override del tag gana; `<tag>#thinking` solo vale para el razonamiento; sin override rige el tipo de llamada", () => {
  assert.equal(resolveModelTimeoutMs(base, "qwen3.5:4b", "qwen"), 120_000);
  assert.equal(resolveModelTimeoutMs(base, "qwen3.5:4b", "qwenThinking"), 180_000);
  assert.equal(resolveModelTimeoutMs(base, "d3:2b", "decision"), 30_000);
  const cfg = { ...base, modelTimeoutsMs: { "qwen3.5:4b": 240_000, "qwen3.5:4b#thinking": 400_000, "d3:2b": 10_000 } };
  assert.equal(resolveModelTimeoutMs(cfg, "qwen3.5:4b", "qwen"), 240_000);
  assert.equal(resolveModelTimeoutMs(cfg, "qwen3.5:4b", "qwenThinking"), 400_000);
  assert.equal(resolveModelTimeoutMs(cfg, "d3:2b", "decision"), 10_000);
  assert.equal(resolveModelTimeoutMs({ ...base, modelTimeoutsMs: { "qwen3.5:4b": 240_000 } }, "qwen3.5:4b", "qwenThinking"), 180_000, "sin `#thinking` el razonamiento no hereda");
});

test("la configuración descarta overrides inválidos (no enteros, no positivos, claves vacías)", () => {
  assert.deepEqual(timeoutMap({ a: 1000, b: 0, c: -5, d: 1.5, e: "9", "  ": 5, f: null }), { a: 1000 });
  assert.deepEqual(timeoutMap(undefined), {});
  assert.deepEqual(timeoutMap([1, 2]), {});
  assert.equal(resolveToolTimeoutMs({ ...base, toolTimeoutsMs: { read_file: Number.NaN } }, "x", "read_file"), undefined);
});
