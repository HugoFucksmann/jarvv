/** Los topes del motor: qué se cuenta, a qué alcance y qué pasa al llegar. Una sola tabla (`engine/limits.ts`), probada por tabla. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import type { CallStatus, TaskContext } from "../src/core/ctx/index.ts";
import {
  LIMIT_SCOPES,
  checkStepLimits,
  countStep,
  escalationsExceeded,
  itemFailuresReached,
  limitValues,
  replansExhausted,
  routeExhausted,
  stepsExhausted,
} from "../src/core/engine/limits.ts";
import { newContext } from "./fixtures.ts";

/** Un paso reactivo con `n` llamadas de cada estado indicado; devuelve el contexto y el id del paso. */
function stepWith(calls: Partial<Record<CallStatus, number>>): { ctx: TaskContext; stepId: string } {
  const ctx = newContext("reactive");
  const stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "paso", route: null, expected: null } }).ids[0];
  let n = 0;
  for (const [status, count] of Object.entries(calls) as [CallStatus, number][]) {
    for (let i = 0; i < count; i++) {
      // `args` es null solo con `args_invalid`; `sig` es null también con `refs_unresolved` (la huella sale de argumentos ya resueltos).
      const args = status === "args_invalid" ? null : {};
      const sig = status === "args_invalid" || status === "refs_unresolved" ? null : `s${n++}`;
      ctx.apply({ op: "add", target: "calls", value: { stepId, route: "web", tool: "research", kind: "read", args, sig, status, summary: null, ref: null } });
    }
  }
  return { ctx, stepId };
}

// ───────────────────────── Contadores ─────────────────────────

test("countStep: ejecución es lo que llegó a la herramienta; intento, todo menos el rechazo del usuario; lo bloqueado no ejecuta", () => {
  const { ctx, stepId } = stepWith({ ok: 2, tool_error: 1, loop_blocked: 2, args_invalid: 1, refs_unresolved: 1, info_missing: 1, tool_rejected: 1, user_rejected: 3 });
  assert.deepEqual(countStep(ctx.find("calls", { stepId })), { executions: 3, attempts: 9, blocked: 2, argsInvalid: 1, userRejected: 3, denied: 1, rejected: 0 });
});

test("countStep: un denied del servidor y una llamada interrumpida cuentan como ejecutadas", () => {
  const { ctx, stepId } = stepWith({ denied: 1, interrupted: 1 });
  assert.equal(countStep(ctx.find("calls", { stepId })).executions, 2);
});

// ───────────────────────── Reglas del paso, por tabla ─────────────────────────

const CASES: { name: string; calls: Partial<Record<CallStatus, number>>; limit: string; cause: string; askFirst: boolean }[] = [
  { name: "repeticiones bloqueadas", calls: { loop_blocked: BUDGET.maxRepeatsPerStep }, limit: "maxRepeatsPerStep", cause: "repeat_blocked", askFirst: false },
  { name: "rechazos del usuario", calls: { user_rejected: BUDGET.maxUserRejectionsPerStep }, limit: "maxUserRejectionsPerStep", cause: "user_rejected", askFirst: false },
  { name: "denegaciones (Guard, lista negra o servidor)", calls: { tool_rejected: 1, denied: BUDGET.maxDeniedPerStep - 1 }, limit: "maxDeniedPerStep", cause: "denied", askFirst: false },
  { name: "argumentos inválidos", calls: { args_invalid: BUDGET.maxReviewRejectionsPerStep }, limit: "maxReviewRejectionsPerStep", cause: "review_rejected", askFirst: false },
  { name: "ejecuciones", calls: { ok: BUDGET.maxCallsPerStep }, limit: "maxCallsPerStep", cause: "call_cap", askFirst: true },
  { name: "intentos sin ejecución", calls: { refs_unresolved: BUDGET.maxAttemptsPerStep }, limit: "maxAttemptsPerStep", cause: "call_cap", askFirst: true },
];

for (const c of CASES) {
  test(`tope del paso: ${c.name} → falla con ${c.cause}`, () => {
    const one = (n: number) => Object.fromEntries(Object.entries(c.calls).map(([k, v]) => [k, (v as number) + n]));
    const below = stepWith(Object.fromEntries(Object.entries(c.calls).map(([k, v]) => [k, (v as number) - 1])));
    assert.equal(checkStepLimits(below.ctx, below.stepId), null, "uno menos del tope: sigue");
    const at = stepWith(c.calls);
    assert.deepEqual(checkStepLimits(at.ctx, at.stepId), { limit: c.limit, cause: c.cause, askFirst: c.askFirst });
    const over = stepWith(one(1) as Partial<Record<CallStatus, number>>);
    assert.equal(checkStepLimits(over.ctx, over.stepId)?.limit, c.limit);
  });
}

test("un paso vacío o con pocas llamadas no alcanza ningún tope", () => {
  const { ctx, stepId } = stepWith({ ok: 1, loop_blocked: 1, args_invalid: 1, user_rejected: 1 });
  assert.equal(checkStepLimits(ctx, stepId), null);
});

test("las repeticiones bloqueadas no gastan ejecuciones: dos bloqueos y cinco ejecuciones no llegan al tope de ejecuciones", () => {
  const { ctx, stepId } = stepWith({ ok: BUDGET.maxCallsPerStep - 1, loop_blocked: BUDGET.maxRepeatsPerStep - 1 });
  assert.equal(checkStepLimits(ctx, stepId), null);
});

test("los rechazos del usuario no cuentan como intentos ni como ejecuciones", () => {
  const { ctx, stepId } = stepWith({ ok: 1, user_rejected: BUDGET.maxUserRejectionsPerStep - 1 });
  const counters = countStep(ctx.find("calls", { stepId }));
  assert.equal(counters.attempts, 1);
  assert.equal(counters.executions, 1);
});

test("precedencia: si se cumplen varios, manda el primero de la tabla (repeticiones, rechazos del usuario, argumentos inválidos, ejecuciones, intentos)", () => {
  const all = stepWith({ ok: BUDGET.maxCallsPerStep, loop_blocked: BUDGET.maxRepeatsPerStep, args_invalid: BUDGET.maxReviewRejectionsPerStep, user_rejected: BUDGET.maxUserRejectionsPerStep });
  assert.equal(checkStepLimits(all.ctx, all.stepId)?.cause, "repeat_blocked");
  const noRepeats = stepWith({ ok: BUDGET.maxCallsPerStep, args_invalid: BUDGET.maxReviewRejectionsPerStep, user_rejected: BUDGET.maxUserRejectionsPerStep });
  assert.equal(checkStepLimits(noRepeats.ctx, noRepeats.stepId)?.cause, "user_rejected");
  const onlyCalls = stepWith({ ok: BUDGET.maxCallsPerStep });
  assert.equal(checkStepLimits(onlyCalls.ctx, onlyCalls.stepId)?.cause, "call_cap");
});

test("los topes del paso son por paso: las llamadas de otro paso no cuentan", () => {
  const ctx = newContext("reactive");
  const first = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "uno", route: null, expected: null } }).ids[0];
  for (let i = 0; i < BUDGET.maxRepeatsPerStep; i++) {
    ctx.apply({ op: "add", target: "calls", value: { stepId: first, route: "web", tool: "research", kind: "read", args: {}, sig: `s${i}`, status: "loop_blocked", summary: null, ref: null } });
  }
  assert.equal(checkStepLimits(ctx, first)?.cause, "repeat_blocked");
  ctx.apply({ op: "update", target: first, value: { state: "failed" } });
  const second = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "dos", route: null, expected: null } }).ids[0];
  assert.equal(checkStepLimits(ctx, second), null, "el paso nuevo arranca de cero");
});

// ───────────────────────── Ruta agotada ─────────────────────────

test("routeExhausted: dos rechazos 'no cumple' de esa ruta en el paso la agotan; otra ruta u otro motivo no", () => {
  const { ctx, stepId } = stepWith({});
  const add = (route: string, reason: "not_accomplished" | "no_usable_data") => {
    const id = ctx.apply({ op: "add", target: "calls", value: { stepId, route, tool: "t", kind: "read", args: {}, sig: `${route}${Math.random()}`, status: "ok", summary: null, ref: null } }).ids[0];
    ctx.apply({ op: "update", target: id, value: { verdict: "rejected", reason } });
  };
  add("files", "not_accomplished");
  assert.equal(routeExhausted(ctx, stepId, "files"), false);
  add("files", "no_usable_data");
  assert.equal(routeExhausted(ctx, stepId, "files"), false, "otro motivo no cuenta");
  add("web", "not_accomplished");
  assert.equal(routeExhausted(ctx, stepId, "files"), false, "otra ruta no cuenta");
  add("files", "not_accomplished");
  assert.equal(routeExhausted(ctx, stepId, "files"), true);
  assert.equal(routeExhausted(ctx, stepId, "web"), false);
});

// ───────────────────────── Topes de la tarea y del ítem ─────────────────────────

test("tarea: pasos al tope, escalaciones por encima del tope y replans al tope", () => {
  const ctx = newContext("reactive");
  assert.equal(stepsExhausted(ctx), false);
  let last = "";
  for (let i = 0; i < BUDGET.maxSteps; i++) {
    if (last !== "") ctx.apply({ op: "update", target: last, value: { state: "failed" } });
    last = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: `p${i}`, route: null, expected: null } }).ids[0];
    // Al agregar el paso `i`, hay `i` pasos fallidos.
    if (i === BUDGET.maxEscalations) assert.equal(escalationsExceeded(ctx), false, "en el tope todavía no se excede");
    if (i === BUDGET.maxEscalations + 1) assert.equal(escalationsExceeded(ctx), true, "uno por encima del tope");
  }
  assert.equal(stepsExhausted(ctx), true);
  assert.equal(replansExhausted(ctx), false);
});

test("ítem: fallos seguidos al tope", () => {
  assert.equal(itemFailuresReached(BUDGET.maxItemFailures - 1), false);
  assert.equal(itemFailuresReached(BUDGET.maxItemFailures), true);
});

// ───────────────────────── Catálogo y /limits ─────────────────────────

test("limitValues: expone todos los topes del catálogo con su valor de BUDGET, y cada uno tiene alcance", () => {
  const values = limitValues();
  const ids = Object.keys(LIMIT_SCOPES);
  assert.deepEqual(Object.keys(values), ids);
  for (const id of ids) {
    assert.equal(typeof values[id as keyof typeof values], "number", id);
    assert.equal(values[id as keyof typeof values], BUDGET[id as keyof typeof BUDGET], id);
  }
  assert.deepEqual([...new Set(Object.values(LIMIT_SCOPES))].sort(), ["item", "step", "task"]);
});

// ───────────────────────── Corte tras rechazos de la verificación ─────────────────────────

test("tope del paso: dos llamadas rechazadas por la verificación fallan el paso con verify_rejected; una sola no", () => {
  const ctx = newContext("reactive");
  const stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "paso", route: null, expected: null } }).ids[0];
  const reject = (i: number): void => {
    const id = ctx.apply({ op: "add", target: "calls", value: { stepId, route: "web", tool: "research", kind: "read", args: {}, sig: `s${i}`, status: "ok", summary: null, ref: null } }).ids[0];
    ctx.apply({ op: "update", target: id, value: { verdict: "rejected", reason: "not_accomplished" } });
  };
  reject(0);
  assert.equal(checkStepLimits(ctx, stepId), null, "un rechazo: se permite un reintento");
  reject(1);
  assert.deepEqual(checkStepLimits(ctx, stepId), { limit: "maxVerifyRejectionsPerStep", cause: "verify_rejected", askFirst: false });
});

test("los rechazos de la verificación son por paso", () => {
  const ctx = newContext("reactive");
  const add = (instruction: string) => ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction, route: null, expected: null } }).ids[0];
  const a = add("uno");
  ctx.apply({ op: "update", target: a, value: { state: "failed" } });
  const b = add("dos");
  for (const stepId of [a, b]) {
    const id = ctx.apply({ op: "add", target: "calls", value: { stepId, route: "web", tool: "research", kind: "read", args: {}, sig: stepId, status: "ok", summary: null, ref: null } }).ids[0];
    ctx.apply({ op: "update", target: id, value: { verdict: "rejected", reason: "no_usable_data" } });
  }
  assert.equal(checkStepLimits(ctx, a), null);
  assert.equal(checkStepLimits(ctx, b), null);
});
