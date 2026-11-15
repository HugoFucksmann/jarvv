/**
 * Invariantes del contexto (`src/core/ctx/`, Fase 2 de auditoría).
 *
 * - Invariante 2: Una tarea terminal rechaza toda escritura en `apply` (salvo `set result` una sola vez en lote posterior).
 * - Invariante 3: `apply` es atómico: un lote inválido no cambia `n`, no altera el snapshot ni emite eventos.
 * - Invariante 4 (nivel ctx): Replan no marca `completed` como `superseded` y `superseded` es irreversible.
 * - Invariante 5 (nivel ctx): `calls` nunca se borran y `effects()` sobreviven a pasos `superseded`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ContextError } from "../src/core/ctx/index.ts";
import type { Op, TaskMode } from "../src/core/ctx/index.ts";
import { buildContext, newContext } from "./fixtures.ts";

function makeTerminalContext(target: "completed" | "failed" | "cancelled" | "partial", mode: TaskMode = "deliberative") {
  const ctx = newContext(mode);
  const planId = mode === "deliberative"
    ? ctx.apply({ op: "add", target: "plans", value: { trigger: "initial", feedback: null, stepId: null } }).ids[0]
    : null;
  const stepId = ctx.apply({
    op: "add",
    target: "steps",
    value: { planId, instruction: "Paso", route: mode === "deliberative" ? "files" : null, expected: mode === "deliberative" ? "ok" : null },
  }).ids[0];
  if (mode === "deliberative") ctx.apply({ op: "update", target: stepId, value: { state: "running" } });
  const callId = ctx.apply({
    op: "add",
    target: "calls",
    value: { stepId, route: "files", tool: "list_directory", kind: "read", args: { path: "C:\\a" }, sig: "s1", status: "ok", summary: "ok", ref: null },
  }).ids[0];
  if (target === "completed") {
    ctx.apply({ op: "update", target: callId, value: { verdict: "approved", reason: null } });
    ctx.apply({ op: "update", target: stepId, value: { state: "completed" } });
    ctx.apply({ op: "finish", target: "task", value: { state: "completed", stopReason: null } });
  } else if (target === "partial") {
    ctx.apply({ op: "update", target: callId, value: { verdict: "approved", reason: null } });
    ctx.apply({ op: "update", target: stepId, value: { state: "failed" } });
    ctx.apply({ op: "finish", target: "task", value: { state: "partial", stopReason: "no_alternatives" } });
  } else if (target === "failed") {
    ctx.apply({ op: "update", target: stepId, value: { state: "failed" } });
    ctx.apply({ op: "finish", target: "task", value: { state: "failed", stopReason: "unrecoverable" } });
  } else {
    ctx.apply({ op: "finish", target: "task", value: { state: "cancelled", stopReason: "user_cancelled" } });
  }
  return { ctx, stepId, callId };
}

test("Invariante 2: todos los estados terminales rechazan add, update, set facts y finish; result se escribe una vez en apply posterior", () => {
  for (const state of ["completed", "failed", "cancelled", "partial"] as const) {
    const { ctx, stepId, callId } = makeTerminalContext(state);
    assert.equal(ctx.isClosed(), true);

    assert.throws(
      () => ctx.apply({ op: "add", target: "errors", value: { stepId, kind: "service_unavailable" } }),
      (e: unknown) => e instanceof ContextError && e.code === "closed",
    );
    assert.throws(
      () => ctx.apply({ op: "update", target: callId, value: { verdict: "rejected", reason: "no_usable_data" } }),
      (e: unknown) => e instanceof ContextError && e.code === "closed",
    );
    assert.throws(
      () => ctx.apply({ op: "set", target: "facts.process", value: { value: "123", stepId } }),
      (e: unknown) => e instanceof ContextError && e.code === "closed",
    );
    assert.throws(
      () => ctx.apply({ op: "finish", target: "task", value: { state: "cancelled", stopReason: "user_cancelled" } }),
      (e: unknown) => e instanceof ContextError && e.code === "closed",
    );

    // Una sola escritura de `result` posterior a `finish` es válida.
    ctx.apply({ op: "set", target: "result", value: { text: "Respuesta final", origin: "model" } });
    // Una segunda escritura de `result` se rechaza (`not_mutable`).
    assert.throws(
      () => ctx.apply({ op: "set", target: "result", value: { text: "Otra", origin: "fallback" } }),
      (e: unknown) => e instanceof ContextError && e.code === "not_mutable",
    );
  }
});

test("Invariante 2 (regla 1): no se puede escribir `result` mientras la tarea corre ni en el mismo lote que `finish`", () => {
  const ctx = newContext("reactive");
  assert.throws(
    () => ctx.apply({ op: "set", target: "result", value: { text: "x", origin: "model" } }),
    (e: unknown) => e instanceof ContextError && e.code === "not_mutable",
  );
  const beforeN = ctx.n;
  assert.throws(
    () =>
      ctx.apply([
        { op: "finish", target: "task", value: { state: "cancelled", stopReason: "user_cancelled" } },
        { op: "set", target: "result", value: { text: "x", origin: "fallback" } },
      ]),
    (e: unknown) => e instanceof ContextError && e.code === "not_mutable",
  );
  assert.equal(ctx.n, beforeN);
  assert.equal(ctx.task.state, "running");
  assert.equal(ctx.result, null);
});

test("Invariante 3: apply es atómico en lotes mixtos (fallo por operación o en checkEnd) — no cambia n ni emite eventos", () => {
  const ctx = newContext("deliberative");
  const planId = ctx.apply({ op: "add", target: "plans", value: { trigger: "initial", feedback: null, stepId: null } }).ids[0];
  const s1 = ctx.apply({ op: "add", target: "steps", value: { planId, instruction: "Paso 1", route: "files", expected: "e1" } }).ids[0];

  let events = 0;
  ctx.on("change", () => events++);

  const nBeforeOpErr = ctx.n;
  const snapBeforeOpErr = ctx.snapshot();

  // Caso A: op 0 válida (set fact + add step) y op 1 inválida (referencia inexistente)
  assert.throws(
    () =>
      ctx.apply([
        { op: "set", target: "facts.tmp", value: { value: "valor", stepId: s1 } },
        { op: "add", target: "steps", value: { planId, instruction: "Paso 2", route: "files", expected: "e2" } },
        { op: "add", target: "calls", value: { stepId: "s999", route: "files", tool: "read_file", kind: "read", args: null, sig: null, status: "ok", summary: null, ref: null } },
      ]),
    (e: unknown) => e instanceof ContextError && e.opIndex === 2,
  );
  assert.equal(ctx.n, nBeforeOpErr);
  assert.equal(events, 0);
  assert.deepEqual(ctx.snapshot(), snapBeforeOpErr);

  // Caso B: todas las ops pasan validación individual pero fallan en `checkEnd` (transición ilegal pending -> completed)
  assert.throws(
    () =>
      ctx.apply([
        { op: "set", target: "facts.tmp", value: { value: "valor", stepId: s1 } },
        { op: "update", target: s1, value: { state: "completed" } },
      ]),
    (e: unknown) => e instanceof ContextError && e.code === "transition",
  );
  assert.equal(ctx.n, nBeforeOpErr);
  assert.equal(events, 0);
  assert.deepEqual(ctx.snapshot(), snapBeforeOpErr);

  // Caso C: dos pasos vigentes en `running` al final del lote también falla en `checkEnd` sin mutar ni emitir
  ctx.apply({ op: "update", target: s1, value: { state: "running" } });
  events = 0;
  const s2 = ctx.apply({ op: "add", target: "steps", value: { planId, instruction: "Paso 2", route: "files", expected: "e2" } }).ids[0];
  events = 0;
  const nBeforeInvariantErr = ctx.n;
  const snapBeforeInvariantErr = ctx.snapshot();
  assert.throws(
    () =>
      ctx.apply([
        { op: "set", target: "facts.tmp2", value: { value: "x", stepId: s1 } },
        { op: "update", target: s2, value: { state: "running" } },
      ]),
    (e: unknown) => e instanceof ContextError && e.code === "invariant",
  );
  assert.equal(ctx.n, nBeforeInvariantErr);
  assert.equal(events, 0);
  assert.deepEqual(ctx.snapshot(), snapBeforeInvariantErr);
});

test("Invariante 4 y 5 (nivel ctx): completed no puede pasar a superseded, superseded es irreversible y calls/effects sobreviven", () => {
  const ctx = buildContext("deliberative", "step_failed");
  const steps = ctx.find("steps", {});
  const s1 = steps.find((s) => s.state === "completed")!;
  const s2 = steps.find((s) => s.state === "failed")!;

  assert.throws(
    () => ctx.apply({ op: "update", target: s1.id, value: { superseded: true } }),
    (e: unknown) => e instanceof ContextError && e.code === "invariant",
  );

  // Simular replan: s2 pasa a superseded: true
  const p2 = ctx.apply({ op: "add", target: "plans", value: { trigger: "step_failure", feedback: null, stepId: s2.id } }).ids[0];
  ctx.apply([
    { op: "update", target: s2.id, value: { superseded: true } },
    { op: "add", target: "steps", value: { planId: p2, instruction: "Reemplazo", route: "files", expected: "listo" } },
  ]);

  // superseded: true -> false prohibido
  assert.throws(
    () => ctx.apply({ op: "update", target: s2.id, value: { superseded: false } }),
    (e: unknown) => e instanceof ContextError && e.code === "invariant",
  );

  // No existe operación de borrado sobre calls y los efectos previos sobreviven al replan.
  assert.throws(
    () => ctx.apply({ op: "delete", target: "calls", value: {} } as unknown as Op),
    (e: unknown) => e instanceof ContextError && e.code === "malformed_op",
  );
  const callsBefore = ctx.find("calls", {}).length;
  assert.ok(callsBefore > 0);
  assert.ok(ctx.effects().some((c) => c.tool === "write_file" && c.status === "ok" && c.verdict === "approved"));
});
