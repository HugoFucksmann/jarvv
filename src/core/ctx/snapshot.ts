/**
 * Snapshot y carga (sección 4 y "Resto de la API" de la sección 6).
 *
 * `cloneData` es el snapshot: una copia profunda en JSON plano. `parseSnapshot` valida un snapshot de arriba abajo con
 * las mismas reglas que `apply` (campos, tipos, vocabularios, referencias, estado terminal por motivo, invariantes)
 * y rechaza con `snapshot_version` los que traen un `v` distinto.
 */

import { assertFinalState } from "./closure.ts";
import { ContextError, violation } from "./errors.ts";
import { makeId, parseId } from "./ids.ts";
import { cloneJson, deepFreeze, isPlainObject, jsonProblem } from "./json.ts";
import {
  CONTEXT_VERSION,
  SECTION_NAMES,
  STEP_STATES,
  STOP_REASONS,
  TASK_MODES,
  TASK_STATES,
} from "./types.ts";
import type {
  Call,
  CallVerdict,
  ContextData,
  ContextLimits,
  ErrorEntry,
  Fact,
  JsonValue,
  Plan,
  Ref,
  SectionName,
  Step,
  TaskInfo,
  VerdictReason,
} from "./types.ts";
import {
  assertVerifiable,
  checkCallInput,
  checkCallPatch,
  checkErrorInput,
  checkFactInput,
  checkFactKey,
  checkPlanInput,
  checkRefInput,
  checkResultInput,
  checkStepInput,
  ensureKeys,
  ensureObject,
  nullableOneOf,
  oneOf,
  reqText,
} from "./validate.ts";
import type { CheckEnv } from "./validate.ts";

/** `ctx.snapshot()`: copia profunda en JSON plano; no comparte nada con el contexto vivo. */
export function cloneData(data: ContextData): ContextData {
  return cloneJson(data as unknown as JsonValue) as unknown as ContextData;
}

/** Valida un snapshot y devuelve los datos listos para usar (elementos congelados). */
export function parseSnapshot(raw: unknown, limits: ContextLimits): ContextData {
  if (!isPlainObject(raw)) throw new ContextError("snapshot_invalid", null, "el snapshot debe ser un objeto JSON plano");
  if (raw.v !== CONTEXT_VERSION) {
    throw new ContextError("snapshot_version", null, `el snapshot es de la versión ${JSON.stringify(raw.v)}; este contexto solo lee la v${CONTEXT_VERSION}`);
  }
  try {
    return parseBody(raw, limits);
  } catch (error) {
    if (error instanceof ContextError) throw new ContextError("snapshot_invalid", null, error.detail);
    throw error;
  }
}

function finiteNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) violation("invalid_value", 3, `${what} debe ser un número finito`);
  return value;
}

/** Cada sección es un arreglo de objetos cuyos ids son `<prefijo>1`, `<prefijo>2`... en orden (nada se borra ni renumera). */
function elementsOf(raw: unknown, section: SectionName): Record<string, unknown>[] {
  if (!Array.isArray(raw)) violation("invalid_value", 3, `\`${section}\` debe ser un arreglo`);
  return raw.map((item: unknown, index: number) => {
    const element = ensureObject(item, `${section}[${index}]`);
    const expected = makeId(section, index);
    if (element.id !== expected) violation("invalid_value", 3, `${section}[${index}].id debe ser "${expected}"`);
    return element;
  });
}

function parseBody(raw: Record<string, unknown>, limits: ContextLimits): ContextData {
  ensureKeys(raw, ["v", "task", "plans", "steps", "calls", "errors", "facts", "refs", "result"], [], "snapshot");
  // Raíz → sección → elemento → args: tres niveles más que la profundidad permitida a un valor JSON.
  const problem = jsonProblem(raw, { maxDepth: limits.jsonMaxDepth + 3, maxString: null });
  if (problem) violation("invalid_value", 3, `snapshot${problem.path.slice(1)}: ${problem.detail}`);

  // ── task
  const t = ensureObject(raw.task, "task");
  ensureKeys(t, ["id", "mode", "request", "state", "stopReason", "startedAt"], [], "task");
  const mode = oneOf(t.mode, TASK_MODES, "task.mode");
  const state = oneOf(t.state, TASK_STATES, "task.state");
  const stopReason = nullableOneOf(t.stopReason, STOP_REASONS, "task.stopReason");
  const task: TaskInfo = deepFreeze({
    id: reqText(t.id, "task.id"),
    mode,
    request: reqText(t.request, "task.request"),
    state,
    stopReason,
    startedAt: finiteNumber(t.startedAt, "task.startedAt"),
  });

  // ── ids en orden y tamaños, antes de resolver referencias
  const [rawPlans, rawSteps, rawCalls, rawErrors, rawRefs] = SECTION_NAMES.map((section) => elementsOf(raw[section], section));
  const sizes = { plans: rawPlans.length, steps: rawSteps.length, refs: rawRefs.length };
  const inRange = (section: "plans" | "steps" | "refs", id: string): boolean => {
    const parsed = parseId(id);
    return parsed !== null && parsed.section === section && parsed.index < sizes[section];
  };
  const lookup: CheckEnv = {
    mode,
    limits,
    hasPlan: (id) => inRange("plans", id),
    hasStep: (id) => inRange("steps", id),
    hasRef: (id) => inRange("refs", id),
  };

  // ── elementos
  const plans: Plan[] = rawPlans.map((el, i) => {
    ensureKeys(el, ["id", "at", "trigger", "feedback", "stepId"], [], "plan");
    const v = checkPlanInput({ trigger: el.trigger, feedback: el.feedback, stepId: el.stepId }, lookup);
    return deepFreeze({ id: makeId("plans", i), at: finiteNumber(el.at, "plan.at"), trigger: v.trigger, feedback: v.feedback, stepId: v.stepId });
  });

  const steps: Step[] = rawSteps.map((el, i) => {
    ensureKeys(el, ["id", "at", "planId", "instruction", "route", "expected", "state", "superseded"], [], "step");
    const v = checkStepInput({ planId: el.planId, instruction: el.instruction, route: el.route, expected: el.expected }, lookup);
    const stepState = oneOf(el.state, STEP_STATES, "step.state");
    if (typeof el.superseded !== "boolean") violation("invalid_value", 3, "step.superseded debe ser booleano");
    if (el.superseded && mode !== "deliberative") violation("invalid_value", 3, "`superseded` solo existe en modo deliberativo");
    return deepFreeze({
      id: makeId("steps", i),
      at: finiteNumber(el.at, "step.at"),
      planId: v.planId,
      instruction: v.instruction,
      route: v.route,
      expected: v.expected,
      state: stepState,
      superseded: el.superseded,
    });
  });

  const calls: Call[] = rawCalls.map((el, i) => {
    ensureKeys(el, ["id", "stepId", "at", "route", "tool", "kind", "args", "sig", "status", "verdict", "reason", "summary", "ref"], [], "call");
    const v = checkCallInput(
      { stepId: el.stepId, route: el.route, tool: el.tool, kind: el.kind, args: el.args, sig: el.sig, status: el.status, summary: el.summary, ref: el.ref },
      lookup,
    );
    const id = makeId("calls", i);
    let verdict: CallVerdict | null = null;
    let reason: VerdictReason | null = null;
    if (el.verdict === null) {
      if (el.reason !== null) violation("invalid_value", 3, `${id}: \`reason\` solo existe con \`rejected\``);
    } else {
      const patch = checkCallPatch({ verdict: el.verdict, reason: el.reason });
      assertVerifiable(id, v.status);
      verdict = patch.verdict;
      reason = patch.reason;
    }
    return deepFreeze({
      id,
      stepId: v.stepId,
      at: finiteNumber(el.at, "call.at"),
      route: v.route,
      tool: v.tool,
      kind: v.kind,
      args: v.args,
      sig: v.sig,
      status: v.status,
      verdict,
      reason,
      summary: v.summary,
      ref: v.ref,
    });
  });

  const errors: ErrorEntry[] = rawErrors.map((el, i) => {
    ensureKeys(el, ["id", "stepId", "at", "kind"], [], "error");
    const v = checkErrorInput({ stepId: el.stepId, kind: el.kind }, lookup);
    return deepFreeze({ id: makeId("errors", i), stepId: v.stepId, at: finiteNumber(el.at, "error.at"), kind: v.kind });
  });

  const refs: Ref[] = rawRefs.map((el, i) => {
    ensureKeys(el, ["id", "stepId", "at", "label", "size", "where"], [], "ref");
    const v = checkRefInput({ stepId: el.stepId, label: el.label, size: el.size, where: el.where }, lookup);
    return deepFreeze({ id: makeId("refs", i), stepId: v.stepId, at: finiteNumber(el.at, "ref.at"), label: v.label, size: v.size, where: v.where });
  });

  // ── hechos y resultado
  const rawFacts = ensureObject(raw.facts, "facts");
  const facts: { [key: string]: Fact } = {};
  for (const key of Object.keys(rawFacts)) {
    checkFactKey(key);
    const f = ensureObject(rawFacts[key], `facts.${key}`);
    ensureKeys(f, ["value", "stepId", "at"], [], `facts.${key}`);
    const v = checkFactInput({ value: f.value, stepId: f.stepId }, lookup);
    facts[key] = deepFreeze({ value: v.value, stepId: v.stepId, at: finiteNumber(f.at, `facts.${key}.at`) });
  }
  const result = raw.result === null ? null : deepFreeze(checkResultInput(raw.result));

  // ── consistencia: invariantes 1 y 2 y estado terminal por motivo (5.3)
  let running = 0;
  for (const step of steps) {
    if (step.superseded && step.state === "completed") violation("invariant", 6, `invariante 1: el paso ${step.id} está \`completed\` y \`superseded\``);
    if (!step.superseded && step.state === "running") running++;
  }
  if (running > 1) violation("invariant", 6, `invariante 2: hay ${running} pasos vigentes \`running\``);

  if (task.state === "running") {
    if (task.stopReason !== null) violation("finish_table", 6, "una tarea `running` no lleva `stopReason`");
  } else {
    assertFinalState(mode, task.state, task.stopReason, steps, calls);
  }

  return { v: CONTEXT_VERSION, task, plans, steps, calls, errors, facts, refs, result };
}
