/** Pruebas de sincronización UI ↔ TaskContext (`ui/utils/applyTaskOps.ts`) y utilidades puras de presentación (`ui/utils/*.ts`). */

import assert from "node:assert/strict";
import { test } from "node:test";

import { create } from "../src/core/ctx/index.ts";
import { getRouteLabel } from "../ui/utils/routeLabels.ts";
import { applyOpsToSummary, applyTaskOps, summaryFromDto } from "../ui/utils/applyTaskOps.ts";
import { formatVerdictReason, getActivityPhrase, getTaskStateLabel, getTaskStatusType, parseProcessPids } from "../ui/utils/taskStatus.ts";
import { formatMs, stageInfo } from "../ui/utils/traceStages.ts";
import type { SseChangeOp, TaskDto } from "../ui/types/api.ts";

function createInitialDto(ctx: ReturnType<typeof create.context>): TaskDto {
  const snap = ctx.snapshot();
  return {
    v: snap.v,
    n: ctx.n,
    task: {
      id: snap.task.id,
      request: snap.task.request,
      mode: snap.task.mode,
      state: snap.task.state,
      stopReason: snap.task.stopReason,
      startedAt: snap.task.startedAt,
    },
    plans: snap.plans,
    steps: snap.steps,
    calls: snap.calls,
    errors: snap.errors,
    refs: snap.refs,
    recalled: snap.recalled,
    facts: snap.facts,
    result: snap.result,
    waiting: null,
    paused: null,
  };
}

test("applyTaskOps: reproducir eventos change de un TaskContext real converge idéntico a ctx.snapshot()", () => {
  let t = 1_700_000_000_000;
  const ctx = create.context(
    { id: "task_sync", request: "Sincronizar estado", mode: "deliberative" },
    { now: () => (t += 100), summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
  );
  let dto = createInitialDto(ctx);

  ctx.on("change", (ev) => {
    dto = applyTaskOps(dto, ev.n, ev.ops as unknown as SseChangeOp[]);
  });

  ctx.apply({ op: "add", target: "recalled", value: { stepId: null, source: "user_memory", key: "nombre", value: "Ana", from: null } });
  const p1 = ctx.apply({ op: "add", target: "plans", value: { trigger: "initial", feedback: null, stepId: null } }).ids[0];
  const s1 = ctx.apply({ op: "add", target: "steps", value: { planId: p1, instruction: "Leer nota", route: "files", expected: "Contenido" } }).ids[0];
  ctx.apply({ op: "update", target: s1, value: { state: "running" } });
  const r1 = ctx.apply({ op: "add", target: "refs", value: { stepId: s1, label: "nota.txt", size: 500, where: "data/refs/t/r1.txt" } }).ids[0];
  const c1 = ctx.apply({
    op: "add",
    target: "calls",
    value: { stepId: s1, route: "files", tool: "read_file", kind: "read", args: { path: "C:\\x\\nota.txt" }, sig: "sig_r", status: "ok", summary: "Contenido", ref: r1 },
  }).ids[0];
  ctx.apply([
    { op: "update", target: c1, value: { verdict: "approved", reason: null } },
    { op: "set", target: "facts.process", value: { value: "42, 99", stepId: s1 } },
    { op: "add", target: "errors", value: { stepId: s1, kind: "service_unavailable" } },
    { op: "update", target: s1, value: { state: "completed" } },
  ]);
  ctx.apply({ op: "finish", target: "task", value: { state: "completed", stopReason: null } });
  ctx.apply({ op: "set", target: "result", value: { origin: "model", text: "Hecho." } });

  const finalSnap = ctx.snapshot();
  assert.equal(dto.n, ctx.n);
  assert.deepEqual(dto.task, finalSnap.task);
  assert.deepEqual(dto.plans, finalSnap.plans);
  assert.deepEqual(dto.steps, finalSnap.steps);
  assert.deepEqual(dto.calls, finalSnap.calls);
  assert.deepEqual(dto.errors, finalSnap.errors);
  assert.deepEqual(dto.refs, finalSnap.refs);
  assert.deepEqual(dto.recalled, finalSnap.recalled);
  assert.deepEqual(dto.facts, finalSnap.facts);
  assert.deepEqual(dto.result, finalSnap.result);
});

test("applyTaskOps: preserva identidad referencial en secciones intactas y es idempotente ante ops add repetidas", () => {
  const ctx = create.context(
    { id: "task_imm", request: "Inmutabilidad", mode: "reactive" },
    { now: () => 1_700_000_000_000, summaryMax: 2500, argsStringMax: 2000, factValueMax: 500, feedbackMax: 1500, jsonMaxDepth: 6 },
  );
  const initial = createInitialDto(ctx);
  const addStepOp: SseChangeOp = {
    op: "add",
    target: "steps",
    value: { id: "s1", planId: null, instruction: "Paso", route: null, expected: null, state: "pending", superseded: false, at: 1 },
  };
  const next1 = applyTaskOps(initial, 1, [addStepOp]);
  assert.notEqual(next1.steps, initial.steps);
  assert.equal(next1.calls, initial.calls);
  assert.equal(next1.facts, initial.facts);
  assert.equal(next1.plans, initial.plans);

  // Entrega duplicada de la misma op add (reconexión SSE / replay)
  const nextDup = applyTaskOps(next1, 1, [addStepOp]);
  assert.equal(nextDup.steps.length, 1);

  const summary = summaryFromDto(next1);
  const closedSummary = applyOpsToSummary(summary, 2, [{ op: "finish", target: "task", value: { state: "partial", stopReason: "max_steps" } }]);
  assert.equal(closedSummary.n, 2);
  assert.equal(closedSummary.state, "partial");
  assert.equal(closedSummary.stopReason, "max_steps");
});

test("ui/utils: taskStatus, routeLabels y traceStages", () => {
  const baseDto: TaskDto = {
    v: 1,
    n: 1,
    task: { id: "t1", request: "Algo", mode: "deliberative", state: "running", stopReason: null, startedAt: 100 },
    plans: [],
    steps: [],
    calls: [],
    errors: [],
    refs: [],
    recalled: [],
    facts: {},
    result: null,
    waiting: null,
    paused: null,
  };

  assert.equal(getActivityPhrase(null).stateGroup, "finished");
  assert.equal(getActivityPhrase(baseDto).label, "Estructurando plan de ejecución…");
  assert.equal(getActivityPhrase({ ...baseDto, task: { ...baseDto.task, mode: "reactive" } }).label, "Evaluando consulta…");
  assert.equal(
    getActivityPhrase({ ...baseDto, waiting: { kind: "approval", request: { id: "w1", mcp: "m", tool: "write_file", capability: "FILE_WRITE", reason: "r", args: {} } } }).stateGroup,
    "waiting",
  );
  assert.match(getActivityPhrase({ ...baseDto, paused: { since: 1, model: "decision" } }).label, /Modelo de decisión/);
  assert.equal(
    getActivityPhrase({ ...baseDto, task: { ...baseDto.task, state: "completed", stopReason: null }, result: null }).label,
    "Redactando respuesta final…",
  );
  assert.equal(
    getActivityPhrase({ ...baseDto, task: { ...baseDto.task, state: "failed", stopReason: "unrecoverable" }, result: { origin: "fallback", text: "err" } }).stateGroup,
    "finished",
  );

  assert.equal(getTaskStatusType("running", true, false), "approval");
  assert.equal(getTaskStatusType("running", false, true), "approval");
  assert.equal(getTaskStatusType("partial", false, false), "unverified");
  assert.equal(getTaskStateLabel("running", "plan"), "Esperando confirmación de plan");
  assert.equal(getTaskStateLabel("completed", null), "Completada");
  assert.deepEqual(parseProcessPids({ value: "101, 202 , ,303", stepId: "s1", at: 1 }), ["101", "202", "303"]);
  assert.deepEqual(parseProcessPids(null), []);
  assert.equal(formatVerdictReason("wrong_place"), "Ubicación incorrecta (wrong_place)");
  assert.equal(formatVerdictReason("custom"), "custom");

  assert.equal(getRouteLabel("files"), "Archivos");
  assert.equal(getRouteLabel("terminal"), "Terminal y procesos");
  assert.equal(getRouteLabel(undefined), "General");

  assert.equal(stageInfo("route").code, "D1");
  assert.equal(stageInfo("final").kind, "generative");
  assert.equal(stageInfo("custom_stage").label, "custom_stage");
  assert.equal(formatMs(450), "450 ms");
  assert.equal(formatMs(1250), "1.25 s");
  assert.equal(formatMs(12500), "12.5 s");
});
