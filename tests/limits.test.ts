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
  toolErrorSignature,
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
      // `args` es null solo con `args_invalid`; `sig` solo es null con él.
      const args = status === "args_invalid" ? null : {};
      const sig = status === "args_invalid" ? null : `s${n++}`;
      ctx.apply({ op: "add", target: "calls", value: { stepId, route: "web", tool: "search", kind: "read", args, sig, status, summary: null, ref: null } });
    }
  }
  return { ctx, stepId };
}

// ───────────────────────── Contadores ─────────────────────────

test("countStep: ejecución es lo que llegó a la herramienta; intento, todo menos el rechazo del usuario; lo bloqueado no ejecuta", () => {
  const { ctx, stepId } = stepWith({ ok: 2, tool_error: 1, loop_blocked: 2, args_invalid: 1, info_missing: 1, tool_rejected: 1, user_rejected: 3 });
  assert.deepEqual(countStep(ctx.find("calls", { stepId })), { executions: 3, attempts: 8, blocked: 2, argsInvalid: 1, userRejected: 3, denied: 1, rejected: 0, toolFailed: 1, sameToolError: 1 });
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
  { name: "intentos sin ejecución", calls: { info_missing: BUDGET.maxAttemptsPerStep }, limit: "maxAttemptsPerStep", cause: "call_cap", askFirst: true },
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
    ctx.apply({ op: "add", target: "calls", value: { stepId: first, route: "web", tool: "search", kind: "read", args: {}, sig: `s${i}`, status: "loop_blocked", summary: null, ref: null } });
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

// ───────────────────────── Topes de la tarea ─────────────────────────

test("tarea: pasos al tope y replans al tope", () => {
  const ctx = newContext("reactive");
  assert.equal(stepsExhausted(ctx), false);
  for (let i = 0; i < BUDGET.maxSteps; i++) {
    const id = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: `p${i}`, route: null, expected: null } }).ids[0];
    ctx.apply({ op: "update", target: id, value: { state: i % 2 === 0 ? "completed" : "failed" } });
  }
  assert.equal(stepsExhausted(ctx), true);
  assert.equal(replansExhausted(ctx), false);
});

test("pasos fallidos seguidos: se cierra por ENCIMA del tope y un paso completado reinicia la racha", () => {
  const ctx = newContext("reactive");
  const step = (state: "completed" | "failed"): void => {
    const id = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "p", route: null, expected: null } }).ids[0];
    ctx.apply({ op: "update", target: id, value: { state } });
  };
  for (let i = 1; i <= BUDGET.maxEscalations + 1; i++) {
    step("failed");
    assert.equal(escalationsExceeded(ctx), i > BUDGET.maxEscalations, `${i} fallidos seguidos`);
  }
  step("completed");
  assert.equal(ctx.consecutiveFailures(), 0, "un paso completado reinicia la racha");
  assert.equal(escalationsExceeded(ctx), false);
  for (let i = 0; i < BUDGET.maxEscalations; i++) step("failed");
  assert.equal(escalationsExceeded(ctx), false, "en el tope todavía no se excede: los fallos de antes del paso completado no se acumulan");
  assert.equal(ctx.escalations(), 2 * BUDGET.maxEscalations + 1, "el total de fallidos de la tarea sigue disponible para las ventanas de las vistas");
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
  assert.deepEqual([...new Set(Object.values(LIMIT_SCOPES))].sort(), ["step", "task"]);
});

// ───────────────────────── Corte tras rechazos de la verificación ─────────────────────────

test("tope del paso: dos llamadas rechazadas por la verificación fallan el paso con verify_rejected; una sola no", () => {
  const ctx = newContext("reactive");
  const stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "paso", route: null, expected: null } }).ids[0];
  const reject = (i: number): void => {
    const id = ctx.apply({ op: "add", target: "calls", value: { stepId, route: "web", tool: "search", kind: "read", args: {}, sig: `s${i}`, status: "ok", summary: null, ref: null } }).ids[0];
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
    const id = ctx.apply({ op: "add", target: "calls", value: { stepId, route: "web", tool: "search", kind: "read", args: {}, sig: stepId, status: "ok", summary: null, ref: null } }).ids[0];
    ctx.apply({ op: "update", target: id, value: { verdict: "rejected", reason: "no_usable_data" } });
  }
  assert.equal(checkStepLimits(ctx, a), null);
  assert.equal(checkStepLimits(ctx, b), null);
});

// ───────────────────────── Errores de la herramienta: contador y topes propios ─────────────────────────

/** Una llamada ejecutada con el veredicto que le da el motor: `tool_error` y `exception` se rechazan sin modelo (`no_usable_data`); un `ok` rechazado, por `not_accomplished`. */
function failedCall(ctx: ReturnType<typeof newContext>, stepId: string, status: "tool_error" | "exception" | "ok", n: number, summary: string | null = null): void {
  const id = ctx.apply({ op: "add", target: "calls", value: { stepId, route: "files", tool: "write_file", kind: "write", args: {}, sig: `e${n}`, status, summary, ref: null } }).ids[0];
  ctx.apply({ op: "update", target: id, value: { verdict: "rejected", reason: status === "ok" ? "not_accomplished" : "no_usable_data" } });
}
const newStep = (ctx: ReturnType<typeof newContext>): string => ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "paso", route: null, expected: null } }).ids[0];

test("tope del paso: el MISMO error de la herramienta dos veces falla el paso con tool_failed; uno solo no", () => {
  const ctx = newContext("reactive");
  const stepId = newStep(ctx);
  failedCall(ctx, stepId, "tool_error", 0, "EBUSY: resource busy");
  assert.equal(checkStepLimits(ctx, stepId), null, "un error: se permite un reintento");
  failedCall(ctx, stepId, "tool_error", 1, "EBUSY: resource busy");
  assert.deepEqual(checkStepLimits(ctx, stepId), { limit: "maxSameToolErrorsPerStep", cause: "tool_failed", askFirst: false }, "el mismo error otra vez: no se gasta un tercer intento");
});

test("tope del paso: si el error CAMBIA, el modelo está corrigiendo y hay un tercer intento; tres errores fallan el paso", () => {
  const ctx = newContext("reactive");
  const stepId = newStep(ctx);
  failedCall(ctx, stepId, "tool_error", 0, "EBUSY: resource busy");
  failedCall(ctx, stepId, "tool_error", 1, "EACCES: permission denied");
  assert.equal(checkStepLimits(ctx, stepId), null, "dos errores distintos: todavía hay un tercer intento");
  failedCall(ctx, stepId, "tool_error", 2, "ENOENT: no such file");
  assert.deepEqual(checkStepLimits(ctx, stepId), { limit: "maxToolErrorsPerStep", cause: "tool_failed", askFirst: false });
});

test("el mismo error se reconoce aunque cambien el pid y la duración; un código de salida distinto es otro error", () => {
  const run = (exit: number, pid: number, duration: string): string => `status: finished · exit code: ${exit} · duration: ${duration} · pid: ${pid} · cwd: C:\\Users\\Ana\nfalló`;
  assert.equal(toolErrorSignature(run(1, 111, "0.3s")), toolErrorSignature(run(1, 222, "1.9s")));
  assert.notEqual(toolErrorSignature(run(1, 111, "0.3s")), toolErrorSignature(run(2, 111, "0.3s")), "otro código de salida: el error cambió");
  assert.equal(toolErrorSignature("  EBUSY:   Resource BUSY "), toolErrorSignature("ebusy: resource busy"));
  assert.equal(toolErrorSignature(null), "");
  // El error de PowerShell repite el comando que falló: con otro comando es el mismo error.
  const elevation = (command: string): string =>
    [
      "status: finished · exit code: 1 · duration: 0.4s · pid: 33804 · cwd: C:\\Users\\hugof",
      "The command failed (exit code 1).",
      "Get-WindowsPackage : La operación solicitada requiere elevación.",
      "En línea: 1 Carácter: 1",
      `+ ${command}`,
      "+ ~~~~~~~~~~~~~~~~~~~~~~~~~~",
      "    + CategoryInfo          : NotSpecified: (:) [Get-WindowsPackage], COMException",
    ].join("\n");
  assert.equal(toolErrorSignature(elevation("Get-WindowsPackage -Online | Where-Object {$_.IdentityName -match 'Mi ...")), toolErrorSignature(elevation("Get-WindowsPackage -Online | Select-Object IdentityName")), "el comando cambia, el error no");
  const english = (position: string, command: string): string => ["The command failed (exit code 1).", "Get-X : Access is denied.", position, `+ ${command}`, "+ ~~~~"].join("\n");
  assert.equal(toolErrorSignature(english("At line:1 char:1", "Get-X")), toolErrorSignature(english("At line:1 char:9", "Get-X -Force")));
  assert.notEqual(toolErrorSignature(elevation("Get-Foo")), toolErrorSignature(elevation("Get-Foo").replace("requiere elevación", "no se encuentra la ruta")), "otro mensaje, otro error");
});

test("el mismo error cuenta aunque haya un rechazo de la verificación en el medio", () => {
  const ctx = newContext("reactive");
  const stepId = newStep(ctx);
  failedCall(ctx, stepId, "tool_error", 0, "EBUSY: resource busy");
  failedCall(ctx, stepId, "ok", 1);
  failedCall(ctx, stepId, "tool_error", 2, "EBUSY: resource busy");
  assert.equal(countStep(ctx.find("calls", { stepId })).sameToolError, 2);
  assert.equal(checkStepLimits(ctx, stepId)?.cause, "tool_failed");
});

test("`exception` cuenta como error de la herramienta, junto con `tool_error`", () => {
  const ctx = newContext("reactive");
  const stepId = newStep(ctx);
  failedCall(ctx, stepId, "tool_error", 0, "error A");
  failedCall(ctx, stepId, "exception", 1, "error B");
  assert.deepEqual(countStep(ctx.find("calls", { stepId })), { executions: 2, attempts: 2, blocked: 0, argsInvalid: 0, userRejected: 0, denied: 0, rejected: 0, toolFailed: 2, sameToolError: 1 });
  failedCall(ctx, stepId, "exception", 2, "error C");
  assert.equal(checkStepLimits(ctx, stepId)?.cause, "tool_failed");
});

test("un error de la herramienta y un rechazo de la verificación NO se suman: el paso sigue hasta el tope de cada tipo", () => {
  const ctx = newContext("reactive");
  const stepId = newStep(ctx);
  failedCall(ctx, stepId, "tool_error", 0, "error A");
  failedCall(ctx, stepId, "ok", 1); // el resultado llegó pero no cumple lo pedido
  assert.deepEqual(countStep(ctx.find("calls", { stepId })), { executions: 2, attempts: 2, blocked: 0, argsInvalid: 0, userRejected: 0, denied: 0, rejected: 1, toolFailed: 1, sameToolError: 1 });
  assert.equal(checkStepLimits(ctx, stepId), null, "antes, estos dos sumaban dos rechazos y fallaban el paso");
  failedCall(ctx, stepId, "ok", 2);
  assert.equal(checkStepLimits(ctx, stepId)?.cause, "verify_rejected", "el segundo rechazo de la verificación sí falla el paso");
});

test("los errores de la herramienta son por paso", () => {
  const ctx = newContext("reactive");
  const a = newStep(ctx);
  failedCall(ctx, a, "tool_error", 0, "EBUSY: resource busy");
  ctx.apply({ op: "update", target: a, value: { state: "failed" } });
  const b = newStep(ctx);
  failedCall(ctx, b, "tool_error", 1, "EBUSY: resource busy");
  assert.equal(checkStepLimits(ctx, b), null, "el error del paso anterior no se arrastra, ni siquiera como «el mismo error»");
});
