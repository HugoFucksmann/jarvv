/** Qué lecturas ve un paso que compila lo leído (`composesFromReads`): todas las de la tarea, no solo las últimas 3. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { BUDGET } from "../src/core/budget.ts";
import { create } from "../src/core/ctx/index.ts";
import type { Call } from "../src/core/ctx/index.ts";
import type { EngineEnv } from "../src/core/engine/env.ts";
import { allReadIds } from "../src/core/engine/readSelection.ts";
import { composesFromReads } from "../src/core/tools/manifest.ts";

function taskWithReads(n: number) {
  const ctx = create.context(
    { id: "t", request: "Buscá cuatro cosas y guardalas", mode: "reactive" },
    { now: () => 1_700_000_000_000, summaryMax: BUDGET.summaryMax, argsStringMax: BUDGET.argsStringDefault, factValueMax: BUDGET.factValueMax, feedbackMax: BUDGET.feedbackMax, jsonMaxDepth: BUDGET.jsonMaxDepth },
  );
  const stepId = ctx.apply({ op: "add", target: "steps", value: { planId: null, instruction: "Buscar", route: null, expected: null } }).ids[0];
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = ctx.apply({ op: "add", target: "calls", value: { stepId, route: "web", tool: "web_search", kind: "read", args: { need: `tema ${i}` }, sig: `s${i}`, status: "ok", summary: `dato ${i}`, ref: null } as Omit<Call, "id" | "at" | "verdict" | "reason"> }).ids[0];
    ctx.apply({ op: "update", target: id, value: { verdict: "approved", reason: null } });
    ids.push(id);
  }
  return { env: { ctx } as unknown as EngineEnv, ids };
}

test("write_file y edit_file componen con lo leído; las demás herramientas no", () => {
  assert.equal(composesFromReads("jarvis_files_write", "write_file"), true);
  assert.equal(composesFromReads("jarvis_files_write", "edit_file"), true);
  assert.equal(composesFromReads("jarvis_files_write", "move_file"), false);
  assert.equal(composesFromReads("jarvis_terminal", "run_command"), false);
});

test("con más lecturas que la ventana, el paso que escribe ve todas (hasta el tope); con las que caben rige la ventana de siempre", () => {
  const four = taskWithReads(BUDGET.caps.lastReads + 1);
  assert.deepEqual(allReadIds(four.env), four.ids, "la más vieja también se ve");
  const few = taskWithReads(BUDGET.caps.lastReads);
  assert.equal(allReadIds(few.env), undefined);
  const many = taskWithReads(BUDGET.caps.readsForContent + 4);
  assert.equal(allReadIds(many.env)?.length, BUDGET.caps.readsForContent);
  assert.deepEqual(allReadIds(many.env), many.ids.slice(-BUDGET.caps.readsForContent), "las más recientes");
});
