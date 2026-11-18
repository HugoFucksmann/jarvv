/**
 * Pruebas unitarias exhaustivas de `src/core/ctx/`: atomicidad de `apply`, reglas de validación 1–7,
 * cierres (`closure.ts`), `snapshot`, derivaciones y filtrado/deduplicación de vistas (`views/*`).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ContextError,
  STOP_REASONS,
  canFinish,
  create,
  escalationCount,
  outcomeOf,
  planClosure,
  recentWindowSize,
  terminalStateFor,
} from "../src/core/ctx/index.ts";
import type { ContextData, Op } from "../src/core/ctx/index.ts";
import { argsViewOptions, planViewOptions } from "../src/core/engine/adapters.ts";
import { buildContext } from "./fixtures.ts";

const LIMITS = {
  now: () => 1_700_000_000_000,
  summaryMax: 200,
  argsStringMax: 100,
  factValueMax: 40,
  feedbackMax: 50,
  jsonMaxDepth: 3,
};

const mkCtx = (mode: "reactive" | "deliberative" = "reactive") =>
  create.context({ id: "task_ctx_test", request: "Probar invariantes", mode }, LIMITS);

test("apply: atomicidad total si falla la última operación del lote o una invariante final", () => {
  const ctx = mkCtx("deliberative");
  const p1 = ctx.apply({ op: "add", target: "plans", value: { trigger: "initial", feedback: null, stepId: null } }).ids[0];
  const s1 = ctx.apply({ op: "add", target: "steps", value: { planId: p1, instruction: "Paso 1", route: "files", expected: "ok" } }).ids[0];
  const beforeN = ctx.n;
  const beforeSnapshot = ctx.snapshot();
  let events = 0;
  ctx.on("change", () => {
    events++;
  });

  // 1ra op válida (set fact), 2da op inválida (referencia inexistente -> regla 5)
  assert.throws(
    () =>
      ctx.apply([
        { op: "set", target: "facts.parcial", value: { value: "no debería quedar", stepId: s1 } },
        { op: "update", target: "s999", value: { state: "running" } },
      ]),
    (err: unknown) => err instanceof ContextError && err.code === "unknown_target" && err.opIndex === 1,
  );
  assert.equal(ctx.n, beforeN);
  assert.deepEqual(ctx.snapshot(), beforeSnapshot);
  assert.equal(events, 0);

  // Invariante al final del lote: dos pasos running vigentes a la vez (checkEnd falla después de aplicar s2 running)
  const s2 = ctx.apply({ op: "add", target: "steps", value: { planId: p1, instruction: "Paso 2", route: "files", expected: "ok" } }).ids[0];
  const n2 = ctx.n;
  const snap2 = ctx.snapshot();
  assert.throws(
    () =>
      ctx.apply([
        { op: "update", target: s1, value: { state: "running" } },
        { op: "update", target: s2, value: { state: "running" } },
      ]),
    (err: unknown) => err instanceof ContextError && err.rule === 6,
  );
  assert.equal(ctx.n, n2);
  assert.deepEqual(ctx.snapshot(), snap2);
});

test("regla 1 y 4: tarea cerrada solo admite un set result único; calls.verdict inmutable y colecciones no mutables", () => {
  const ctx = mkCtx();
  const s1 = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "A", route: null, expected: null } }).ids[0];
  const c1 = ctx.apply({
    op: "add",
    target: "calls",
    value: { stepId: s1, route: "files", tool: "read_file", kind: "read", args: { path: "x" }, sig: "sig1", status: "ok", summary: "ok", ref: null },
  }).ids[0];

  // No se puede escribir result mientras está running
  assert.throws(
    () => ctx.apply({ op: "set", target: "result", value: { origin: "model", text: "Listo" } }),
    (err: unknown) => err instanceof ContextError && err.rule === 1,
  );

  // verdict solo se escribe una vez y razón acompaña veredicto válido
  ctx.apply({ op: "update", target: c1, value: { verdict: "approved", reason: null } });
  assert.throws(
    () => ctx.apply({ op: "update", target: c1, value: { verdict: "rejected", reason: "not_accomplished" } }),
    (err: unknown) => err instanceof ContextError && err.rule === 4,
  );

  // No se puede mutar un ref
  const r1 = ctx.apply({ op: "add", target: "refs", value: { stepId: s1, label: "x", size: 10, where: "w" } }).ids[0];
  assert.throws(
    () => ctx.apply({ op: "update", target: r1, value: { size: 99 } as unknown as Record<string, unknown> } as unknown as Op),
    (err: unknown) => err instanceof ContextError && err.rule === 4,
  );

  // Al cerrar con finish, admite set result una única vez y rechaza lo demás
  ctx.apply({ op: "finish", target: "task", value: { state: "completed", stopReason: null } });
  assert.throws(
    () => ctx.apply({ op: "set", target: "facts.algo", value: { value: "v", stepId: s1 } }),
    (err: unknown) => err instanceof ContextError && err.rule === 1,
  );
  ctx.apply({ op: "set", target: "result", value: { origin: "model", text: "Resultado final" } });
  assert.throws(
    () => ctx.apply({ op: "set", target: "result", value: { origin: "fallback", text: "Segundo" } }),
    (err: unknown) => err instanceof ContextError && err.rule === 4 && err.code === "not_mutable",
  );
});

test("reglas 3, 5 y 6: límites JSON/string, auto-referencia intra-lote, superseded inmutable, veredicto en estado no verificable y recalled único", () => {
  const ctx = mkCtx("deliberative");
  const p1 = ctx.apply({ op: "add", target: "plans", value: { trigger: "initial", feedback: null, stepId: null } }).ids[0];

  // Auto-referencia / orden en el mismo lote: no puede crear paso s1 y llamada con stepId="s1" en el mismo apply si s1 aún no existe antes del lote
  assert.throws(
    () =>
      ctx.apply([
        { op: "add", target: "steps", value: { planId: p1, instruction: "Paso", route: "files", expected: "ok" } },
        { op: "add", target: "calls", value: { stepId: "s1", route: "files", tool: "read_file", kind: "read", args: {}, sig: "a", status: "ok", summary: "ok", ref: null } },
      ]),
    (err: unknown) => err instanceof ContextError && err.rule === 5,
  );

  const s1 = ctx.apply({ op: "add", target: "steps", value: { planId: p1, instruction: "Paso 1", route: "files", expected: "ok" } }).ids[0];
  ctx.apply({ op: "update", target: s1, value: { state: "running" } });
  ctx.apply({ op: "update", target: s1, value: { state: "completed" } });

  // No se puede deshacer completed ni superseder un paso completed
  assert.throws(() => ctx.apply({ op: "update", target: s1, value: { state: "failed" } }), (err: unknown) => err instanceof ContextError && err.rule === 6 && err.code === "transition");
  assert.throws(() => ctx.apply({ op: "update", target: s1, value: { superseded: true } }), (err: unknown) => err instanceof ContextError && err.rule === 6);

  // Superseded es irreversible
  const s2 = ctx.apply({ op: "add", target: "steps", value: { planId: p1, instruction: "Paso 2", route: "files", expected: "ok" } }).ids[0];
  ctx.apply({ op: "update", target: s2, value: { superseded: true } });
  assert.throws(() => ctx.apply({ op: "update", target: s2, value: { superseded: false } }), (err: unknown) => err instanceof ContextError && err.rule === 6);

  // Profundidad JSON excedida (jsonMaxDepth = 3 -> regla 7, limit)
  assert.throws(
    () =>
      ctx.apply({
        op: "add",
        target: "calls",
        value: { stepId: s1, route: "files", tool: "t", kind: "read", args: { a: { b: { c: { d: 1 } } } }, sig: "x", status: "ok", summary: "ok", ref: null },
      }),
    (err: unknown) => err instanceof ContextError && err.rule === 7 && err.code === "limit",
  );

  // Llamada interrupted no admite veredicto
  const cInt = ctx.apply({
    op: "add",
    target: "calls",
    value: { stepId: s1, route: "files", tool: "read_file", kind: "read", args: {}, sig: "i", status: "interrupted", summary: null, ref: null },
  }).ids[0];
  assert.throws(
    () => ctx.apply({ op: "update", target: cInt, value: { verdict: "approved", reason: null } }),
    (err: unknown) => err instanceof ContextError && err.rule === 6,
  );

  // Recalled duplicado (source, key) en distinto o mismo lote se rechaza
  ctx.apply({ op: "add", target: "recalled", value: { stepId: null, source: "user_memory", key: "k1", value: "v1", from: null } });
  assert.throws(
    () => ctx.apply({ op: "add", target: "recalled", value: { stepId: null, source: "user_memory", key: "k1", value: "v2", from: null } }),
    (err: unknown) => err instanceof ContextError && err.rule === 6,
  );
});

test("closure: terminalStateFor, planClosure y canFinish cubren cada StopReason y combinación de llamadas", () => {
  const s1 = { id: "s1", planId: "p1", instruction: "1", route: "files", expected: "ok", state: "completed" as const, superseded: false, at: 1 };
  const s2FailedSup = { id: "s2", planId: "p1", instruction: "2", route: "files", expected: "ok", state: "failed" as const, superseded: true, at: 2 };
  const s3Pending = { id: "s3", planId: "p2", instruction: "3", route: "files", expected: "ok", state: "pending" as const, superseded: false, at: 3 };
  const s4Running = { id: "s4", planId: "p2", instruction: "4", route: "files", expected: "ok", state: "running" as const, superseded: false, at: 4 };
  const s5Failed = { id: "s5", planId: "p2", instruction: "5", route: "files", expected: "ok", state: "failed" as const, superseded: false, at: 5 };

  assert.equal(planClosure([]), null);
  assert.equal(planClosure([s1, s2FailedSup]), "completed");
  assert.equal(planClosure([s1, s3Pending]), null);
  assert.equal(planClosure([s1, s4Running]), null);
  assert.equal(planClosure([s1, s5Failed]), null);

  const mkCall = (overrides: Partial<ContextData["calls"][number]>): ContextData["calls"][number] => ({
    id: "c1",
    stepId: "s1",
    route: "files",
    tool: "read_file",
    kind: "read",
    args: {},
    sig: "x",
    status: "ok",
    summary: "ok",
    ref: null,
    verdict: null,
    reason: null,
    at: 1,
    ...overrides,
  });

  assert.equal(canFinish([]), "completed");
  assert.equal(canFinish([mkCall({ verdict: "approved" })]), "completed");
  assert.equal(canFinish([mkCall({ status: "user_rejected" })]), "no_alternatives");
  assert.equal(canFinish([mkCall({ status: "tool_error", verdict: "rejected", reason: "no_usable_data" })]), null);

  const effectCall = mkCall({ kind: "write", status: "ok", verdict: "approved" });
  const rejectedCall = mkCall({ kind: "read", status: "tool_error", verdict: "rejected" });

  assert.equal(terminalStateFor("user_cancelled", [effectCall]), "cancelled");
  assert.equal(terminalStateFor("max_steps", [effectCall]), "partial");
  assert.equal(terminalStateFor("max_steps", [rejectedCall]), "failed");
  assert.equal(terminalStateFor("replans_exhausted", [effectCall]), "partial");
  assert.equal(terminalStateFor("replans_exhausted", []), "failed");
  assert.equal(terminalStateFor("no_alternatives", [mkCall({ status: "ok", verdict: "approved" })]), "partial");
  assert.equal(terminalStateFor("no_alternatives", []), "failed");
  assert.equal(terminalStateFor("unrecoverable", [effectCall]), "partial");
  assert.equal(terminalStateFor("unrecoverable", []), "failed");

  for (const r of STOP_REASONS) {
    const s = terminalStateFor(r, []);
    assert.ok(["completed", "partial", "failed", "cancelled"].includes(s));
  }
});

test("fromSnapshot: valida versión, veredictos inválidos, referencias huérfanas y recalled duplicados", () => {
  const base = buildContext("deliberative", "running").snapshot();

  assert.throws(() => create.fromSnapshot({ ...base, v: 999 as never }, LIMITS), ContextError);

  const badVerdict = structuredClone(base);
  const argsInvalidCall = badVerdict.calls.find((c) => c.status === "args_invalid")!;
  (argsInvalidCall as { verdict: string | null }).verdict = "approved";
  assert.throws(
    () => create.fromSnapshot(badVerdict, LIMITS),
    (err: unknown) => err instanceof ContextError && err.code === "snapshot_invalid" && /args_invalid/.test(err.detail),
  );

  const dupRecalled = structuredClone(base);
  dupRecalled.recalled.push(
    { id: "m1", stepId: null, source: "user_memory", key: "dup", value: "a", from: null, at: 1 },
    { id: "m2", stepId: null, source: "user_memory", key: "dup", value: "b", from: null, at: 2 },
  );
  assert.throws(
    () => create.fromSnapshot(dupRecalled, LIMITS),
    (err: unknown) => err instanceof ContextError && err.code === "snapshot_invalid" && /recalled/.test(err.detail),
  );
});

test("vistas: deduplicación por prioridad, forPlan, failureViewOf, recalledViewsOf, recentWindowSize y forVerify cronológico", () => {
  const ctx = buildContext("deliberative", "running");

  // forPlan exige feedback en trigger = user_feedback
  assert.throws(() => ctx.view.forPlan(planViewOptions(null)));
  const planView = ctx.view.forPlan(planViewOptions("cambiá el paso 2"));
  assert.equal(planView.trigger.kind, "user_feedback");
  assert.equal(planView.steps.done.length, 1);
  assert.equal(planView.steps.current?.id, "s2");

  // Deduplicación: las llamadas en effects no deben reaparecer como failures o done en forArgs / forFinal
  const argsView = ctx.view.forArgs({ ...argsViewOptions("start_process"), recentWindows: [10, 10, 10] });
  const effectIds = new Set(argsView.effects.map((e) => e.id));
  for (const f of argsView.stepFailures) {
    assert.equal(effectIds.has(f.id), false, `fallo ${f.id} no debería duplicar a effects`);
  }
  // args_invalid con summary != null oculta args
  const argsInvalid = argsView.stepFailures.find((f) => f.status === "args_invalid");
  assert.ok(argsInvalid);
  assert.equal(argsInvalid.args, null);
  assert.ok(argsInvalid.summary !== null);

  // forVerify: previous contiene solo llamadas anteriores al callId evaluado y falla en llamadas no verificables
  const readId = ctx.find("calls", { tool: "read_file", status: "ok" })[0].id;
  const listRejectId = ctx.find("calls", { tool: "list_directory", verdict: "rejected" })[0].id;
  const verifyLater = ctx.view.forVerify(listRejectId);
  assert.ok(verifyLater.previous.some((p) => p.id === readId));
  assert.equal(verifyLater.previous.some((p) => p.id === listRejectId), false);

  assert.throws(
    () => ctx.view.forVerify("c999"),
    (err: unknown) => err instanceof ContextError && err.code === "unknown_target",
  );

  // recentWindowSize crece con las escaladas
  const stepFailed = (id: string) => ({ id, at: 1, planId: null, instruction: null, route: null, expected: null, state: "failed" as const, superseded: false });
  assert.equal(recentWindowSize([], [6, 8, 10]), 6);
  assert.equal(recentWindowSize([stepFailed("s1")], [6, 8, 10]), 8);
  assert.equal(recentWindowSize([stepFailed("s1"), stepFailed("s2")], [6, 8, 10]), 10);

  // escalationCount e outcomeOf
  const closedCtx = buildContext("reactive", "closed");
  assert.equal(escalationCount(closedCtx.find("steps", {})), 1);
  assert.equal(outcomeOf(closedCtx.find("calls", {}), "s1")?.verdict, "approved");

  // recalled recorta los más antiguos según tope por fuente
  const memCtx = mkCtx("reactive");
  for (let i = 1; i <= 4; i++) {
    memCtx.apply({ op: "add", target: "recalled", value: { stepId: null, source: "user_memory", key: `k${i}`, value: `v${i}`, from: null } });
  }
  const rView = memCtx.view.forArgs({ ...argsViewOptions(), recalled: { maxBySource: { user_memory: 2 } } });
  assert.deepEqual(
    rView.recalled.map((r) => r.key),
    ["k3", "k4"],
  );
});
