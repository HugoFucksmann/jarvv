/**
 * Pausa por modelo no disponible (`MEMORIA_CONTEXTO_DISENO.md` §6.1): `queryModel` espera y repite la MISMA consulta cuando el modelo no responde, con tope y cancelación,
 * y no pausa lo que esperar no arregla (URL sin configurar, desborde, respuesta inválida).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { EngineEnv } from "../src/core/engine/env.ts";
import { classifyRequest, detectContinuation } from "../src/core/engine/classify.ts";
import { queryModel } from "../src/core/engine/failures.ts";
import type { ModelPauseContext } from "../src/core/engine/failures.ts";
import { TaskRuntime } from "../src/core/engine/runtime.ts";
import type { ModelPause } from "../src/core/engine/runtime.ts";
import { DecisionServiceUnavailableError, DecisionValidationError, LLMServiceUnavailableError, LLMValidationError } from "../src/core/models/transport.ts";
import { PAUSE_RETRY_MIN_MS } from "../src/core/timeouts.ts";
import { newContext } from "./fixtures.ts";

/** Un contexto de pausa con un doble de la tarea que anota cada `setPaused`. */
function pauseContext(maxPauseMs: number, signal: AbortSignal = new AbortController().signal): { readonly pause: ModelPauseContext; readonly marks: (ModelPause | null)[] } {
  const marks: (ModelPause | null)[] = [];
  return {
    marks,
    pause: { model: "decision", maxPauseMs, runtime: { signal, cancelled: signal.aborted, setPaused: (p) => void marks.push(p) } },
  };
}

test("pausa: el modelo no responde y vuelve: se repite la misma consulta, la tarea queda pausada y luego se libera", async () => {
  const { pause, marks } = pauseContext(60_000);
  let calls = 0;
  const t0 = Date.now();
  const result = await queryModel(
    async () => {
      if (calls++ === 0) throw new DecisionServiceUnavailableError("sin conexión (prueba)");
      return "respuesta";
    },
    pause,
  );
  assert.deepEqual(result, { ok: true, value: "respuesta" });
  assert.equal(calls, 2, "la misma consulta se repitió una vez");
  assert.ok(Date.now() - t0 >= PAUSE_RETRY_MIN_MS - 100, "esperó el primer retraso antes de reintentar");
  assert.equal(marks.length, 2);
  assert.equal(marks[0]?.model, "decision");
  assert.equal(typeof marks[0]?.since, "number");
  assert.equal(marks[1], null, "al terminar la pausa se limpia");
});

test("pausa: agotado el tope devuelve el fallo `unavailable` y limpia la pausa", async () => {
  const { pause, marks } = pauseContext(60);
  let calls = 0;
  const result = await queryModel(
    async () => {
      calls++;
      throw new LLMServiceUnavailableError("caído (prueba)");
    },
    { ...pause, model: "llm" },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure, "unavailable");
  assert.ok(calls >= 2, "reintentó al menos una vez antes de rendirse");
  assert.equal(marks[0]?.model, "llm");
  assert.equal(marks[marks.length - 1], null);
});

test("pausa: no se pausa lo que esperar no arregla (URL sin configurar, desborde, respuesta inválida)", async () => {
  const cases: [string, () => never][] = [
    ["sin configurar (decisión)", () => { throw new DecisionServiceUnavailableError("sin URL", undefined, false); }],
    ["sin configurar (llm)", () => { throw new LLMServiceUnavailableError("sin URL", undefined, undefined, false); }],
    ["desborde", () => { throw new DecisionValidationError("no cabe", true); }],
    ["desborde del llm", () => { throw new LLMValidationError("no cabe", undefined, undefined, true); }],
    ["inválida", () => { throw new DecisionValidationError("formato"); }],
  ];
  for (const [name, fail] of cases) {
    const { pause, marks } = pauseContext(60_000);
    let calls = 0;
    const result = await queryModel(async () => { calls++; return fail(); }, pause);
    assert.equal(result.ok, false, name);
    assert.equal(calls, 1, `${name}: una sola consulta`);
    assert.deepEqual(marks, [], `${name}: nunca se pausó`);
  }
});

test("pausa: sin contexto de pausa o con tope 0 el fallo es inmediato (los tests y los usos viejos siguen igual)", async () => {
  for (const pause of [undefined, pauseContext(0).pause]) {
    let calls = 0;
    const result = await queryModel(async () => { calls++; throw new DecisionServiceUnavailableError("caído"); }, pause);
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  }
});

test("pausa: una respuesta inválida no se repite aquí (Qwen reintenta por su cuenta) ni pausa", async () => {
  const { pause, marks } = pauseContext(60_000);
  let calls = 0;
  const result = await queryModel(async () => { calls++; throw new DecisionValidationError("formato"); }, pause);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure, "invalid");
  assert.equal(calls, 1);
  assert.deepEqual(marks, []);
});

test("pausa: cancelar la tarea durante la espera corta la pausa y devuelve `cancelled`", async () => {
  const controller = new AbortController();
  const { pause, marks } = pauseContext(60_000, controller.signal);
  setTimeout(() => controller.abort(), 40);
  const t0 = Date.now();
  const result = await queryModel(async () => { throw new DecisionServiceUnavailableError("caído"); }, { ...pause, runtime: { ...pause.runtime, get cancelled() { return controller.signal.aborted; } } });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure, "cancelled");
  assert.ok(Date.now() - t0 < PAUSE_RETRY_MIN_MS, "no esperó el retraso completo");
  assert.equal(marks[marks.length - 1], null);
});

test("TaskRuntime: `setPaused` avisa solo cuando cambia y cancelar limpia la pausa", () => {
  const seen: (ModelPause | null)[] = [];
  const runtime = new TaskRuntime({ onPause: (p) => void seen.push(p) });
  assert.equal(runtime.paused, null);
  runtime.setPaused(null);
  assert.equal(seen.length, 0, "limpiar lo que no está pausado no avisa");
  runtime.setPaused({ since: 10, model: "llm" });
  runtime.setPaused({ since: 10, model: "llm" });
  assert.equal(seen.length, 1, "el mismo estado no se avisa dos veces");
  assert.deepEqual(runtime.paused, { since: 10, model: "llm" });
  runtime.cancel();
  assert.equal(runtime.paused, null);
  assert.equal(seen[seen.length - 1], null, "al cancelar se avisa que ya no hay pausa");
});

/** Un `EngineEnv` mínimo para D0 y la continuación (lo único que leen: tarea, ejecución, Decisión y `deps`). */
function classifyEnv(firstQuery: (input: unknown, signal: AbortSignal) => Promise<unknown>, pauseMaxMs: number, extra: { readonly continuation?: (input: unknown, signal: AbortSignal) => Promise<unknown>; readonly previous?: boolean } = {}) {
  const ctx = newContext("reactive");
  const marks: (ModelPause | null)[] = [];
  const runtime = new TaskRuntime({ onPause: (p) => void marks.push(p) });
  const env = {
    ctx,
    runtime,
    decision: { firstQuery, ...(extra.continuation === undefined ? {} : { continuation: extra.continuation }) },
    deps: { modelUnavailablePauseMaxMs: () => pauseMaxMs, ...(extra.previous === true ? { previousTask: { request: "antes", answer: "respuesta" } } : {}) },
  } as unknown as EngineEnv;
  return { env, ctx, runtime, marks };
}

test("D0 con la pausa: el modelo de decisión vuelve y la clasificación sigue donde estaba", async () => {
  let calls = 0;
  const { env, marks } = classifyEnv(async () => {
    if (calls++ === 0) throw new DecisionServiceUnavailableError("sin conexión (prueba)");
    return { kind: "single", probabilities: {}, multi: 0, rawInput: "", rawOutput: "" };
  }, 60_000);
  const outcome = await classifyRequest(env);
  assert.deepEqual(outcome, { kind: "classified", first: "single" });
  assert.equal(calls, 2);
  assert.equal(marks.length, 2);
  assert.equal(marks[1], null);
});

test("D0 con la pausa agotada cierra unrecoverable; con URL sin configurar cierra de inmediato", async () => {
  const exhausted = classifyEnv(async () => { throw new DecisionServiceUnavailableError("caído"); }, 60);
  assert.deepEqual(await classifyRequest(exhausted.env), { kind: "close", stopReason: "unrecoverable" });

  let calls = 0;
  const unconfigured = classifyEnv(async () => { calls++; throw new DecisionServiceUnavailableError("sin URL", undefined, false); }, 60_000);
  assert.deepEqual(await classifyRequest(unconfigured.env), { kind: "close", stopReason: "unrecoverable" });
  assert.equal(calls, 1);
  assert.deepEqual(unconfigured.marks, [], "sin pausa");
});

test("continuación con el modelo caído y la pausa agotada cierra unrecoverable; inválida o desborde siguen sin hilo", async () => {
  const noFirst = async (): Promise<unknown> => ({ kind: "single" });
  const down = classifyEnv(noFirst, 60, { previous: true, continuation: async () => { throw new DecisionServiceUnavailableError("caído"); } });
  assert.deepEqual(await detectContinuation(down.env), { kind: "close", stopReason: "unrecoverable" });
  for (const overflow of [false, true]) {
    const bad = classifyEnv(noFirst, 60_000, { previous: true, continuation: async () => { throw new DecisionValidationError("formato", overflow); } });
    assert.deepEqual(await detectContinuation(bad.env), { kind: "resolved", previous: null });
  }
});
