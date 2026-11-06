/**
 * Validación a nivel de campo (sección 6, reglas 2, 3, 5 y 7). Cada función recibe un valor desconocido y devuelve
 * el valor ya validado (y copiado, si es un objeto) o lanza `ContextError`; nunca recorta.
 *
 * Los chequeos que dependen del estado del lote (regla 1, mutabilidad, transiciones, invariantes) están en apply.ts.
 * Las referencias se resuelven siempre contra el contexto previo al lote: un lote no puede usar ids que él mismo crea.
 * Los topes numéricos no son del contexto: llegan en `CheckEnv.limits`, pasados por quien creó el contexto.
 */

import { violation } from "./errors.ts";
import { cloneJson, isPlainObject, jsonProblem } from "./json.ts";
import {
  CALL_KINDS,
  CALL_STATUSES,
  CALL_VERDICTS,
  ERROR_KINDS,
  PLAN_TRIGGERS,
  RESULT_ORIGINS,
  STEP_STATES,
  STOP_REASONS,
  TERMINAL_TASK_STATES,
  VERDICT_REASONS,
  VERIFIABLE_CALL_STATUSES,
} from "./types.ts";
import type {
  CallInput,
  CallPatch,
  CallStatus,
  ChangeMeta,
  ContextLimits,
  ErrorInput,
  FactInput,
  FinishValue,
  JsonObject,
  PlanInput,
  RefInput,
  ResultEntry,
  StepInput,
  StepPatch,
  TaskMode,
} from "./types.ts";

/** Entorno de validación: modo de la tarea, topes y resolución de referencias contra el contexto previo al lote. */
export interface CheckEnv {
  readonly mode: TaskMode;
  readonly limits: ContextLimits;
  hasPlan(id: string): boolean;
  hasStep(id: string): boolean;
  hasRef(id: string): boolean;
}

// ───────────────────────── Primitivas ─────────────────────────

export function ensureObject(raw: unknown, what: string): Record<string, unknown> {
  if (!isPlainObject(raw)) violation("invalid_value", 3, `${what} debe ser un objeto JSON plano`);
  return raw;
}

/** Regla 3: los campos son exactamente los del esquema, todos presentes (lo que no aplica vale `null`). */
export function ensureKeys(obj: Record<string, unknown>, required: readonly string[], optional: readonly string[], what: string): void {
  for (const key of Object.keys(obj)) {
    if (!required.includes(key) && !optional.includes(key)) {
      violation("invalid_value", 3, `${what}: campo desconocido "${key}"`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      violation("invalid_value", 3, `${what}: falta el campo "${key}" (todos los campos están siempre presentes; lo que no aplica vale null)`);
    }
  }
}

export function reqText(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) violation("invalid_value", 3, `${what} debe ser un texto no vacío`);
  return value;
}

/** `null` o un texto no vacío: nunca `""` (5.1). Con `max`, el exceso es un error de tope (regla 7). */
function nullableText(value: unknown, what: string, max?: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) violation("invalid_value", 3, `${what} debe ser null o un texto no vacío (nunca "")`);
  if (max !== undefined && value.length > max) violation("limit", 7, `${what} supera el tope de ${max} caracteres (tiene ${value.length})`);
  return value;
}

export function oneOf<T extends string>(value: unknown, list: readonly T[], what: string): T {
  if (typeof value !== "string" || !(list as readonly string[]).includes(value)) {
    violation("invalid_value", 3, `${what} debe ser uno de: ${list.join(", ")}`);
  }
  return value as T;
}

export function nullableOneOf<T extends string>(value: unknown, list: readonly T[], what: string): T | null {
  return value === null ? null : oneOf(value, list, what);
}

// ───────────────────────── Argumentos y hechos ─────────────────────────

/** Regla 3 (JSON plano) y regla 7 (ningún string supera `argsStringMax`; la anidación no supera `jsonMaxDepth`). */
function checkArgs(raw: unknown, limits: ContextLimits): JsonObject {
  if (!isPlainObject(raw)) violation("invalid_value", 3, "call.args debe ser null o un objeto JSON plano");
  const problem = jsonProblem(raw, { maxDepth: limits.jsonMaxDepth, maxString: limits.argsStringMax });
  if (problem?.kind === "limit") violation("limit", 7, `call.args${problem.path.slice(1)}: ${problem.detail}`);
  if (problem) violation("invalid_value", 3, `call.args${problem.path.slice(1)}: ${problem.detail}`);
  return cloneJson(raw as JsonObject);
}

const FACT_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Regla 7: formato de clave de `facts`. */
export function checkFactKey(key: string): string {
  if (!FACT_KEY_PATTERN.test(key)) violation("limit", 7, `la clave de hecho "${key}" no cumple ${FACT_KEY_PATTERN.source}`);
  return key;
}

// ───────────────────────── `add` ─────────────────────────

export function checkPlanInput(raw: unknown, env: CheckEnv): PlanInput {
  const o = ensureObject(raw, "plan");
  ensureKeys(o, ["trigger", "feedback", "stepId"], [], "plan");
  if (env.mode !== "deliberative") violation("invalid_value", 3, "`plans` solo existe en modo deliberativo");
  const trigger = oneOf(o.trigger, PLAN_TRIGGERS, "plan.trigger");
  const feedback = nullableText(o.feedback, "plan.feedback", env.limits.feedbackMax);
  const stepId = nullableText(o.stepId, "plan.stepId");
  switch (trigger) {
    case "initial":
      if (feedback !== null || stepId !== null) violation("invalid_value", 3, "plan `initial`: `feedback` y `stepId` valen null");
      break;
    case "user_feedback":
      // Un rechazo del plan sin instrucción cierra con `user_cancelled` (FLUJO 6): un plan `user_feedback` siempre la trae.
      if (feedback === null) violation("invalid_value", 3, "plan `user_feedback` requiere `feedback` (la instrucción del usuario)");
      if (stepId !== null) violation("invalid_value", 3, "plan `user_feedback`: `stepId` vale null");
      break;
    case "step_failure":
      if (feedback !== null) violation("invalid_value", 3, "plan `step_failure`: `feedback` vale null");
      if (stepId === null) violation("invalid_value", 3, "plan `step_failure` requiere `stepId` (el paso que falló)");
      if (!env.hasStep(stepId)) violation("dangling_ref", 5, `plan.stepId "${stepId}" no existe`);
      break;
  }
  return { trigger, feedback, stepId };
}

/** 5.2: en deliberativo `instruction`, `route` y `expected` son obligatorios; en reactivo los cuatro campos valen `null`. */
export function checkStepInput(raw: unknown, env: CheckEnv): StepInput {
  const o = ensureObject(raw, "step");
  ensureKeys(o, ["planId", "instruction", "route", "expected"], [], "step");
  const planId = nullableText(o.planId, "step.planId");
  const instruction = nullableText(o.instruction, "step.instruction");
  const route = nullableText(o.route, "step.route");
  const expected = nullableText(o.expected, "step.expected");
  if (env.mode === "reactive") {
    if (planId !== null || instruction !== null || route !== null || expected !== null) {
      violation("invalid_value", 3, "en reactivo `planId`, `instruction`, `route` y `expected` del paso valen null");
    }
  } else {
    if (planId === null) violation("invalid_value", 3, "en deliberativo el paso requiere `planId`");
    if (instruction === null) violation("invalid_value", 3, "en deliberativo el paso requiere `instruction`");
    if (route === null) violation("invalid_value", 3, "en deliberativo el paso requiere `route`");
    if (expected === null) violation("invalid_value", 3, "en deliberativo el paso requiere `expected`");
    if (!env.hasPlan(planId)) violation("dangling_ref", 5, `step.planId "${planId}" no existe`);
  }
  return { planId, instruction, route, expected };
}

export function checkCallInput(raw: unknown, env: CheckEnv): CallInput {
  const o = ensureObject(raw, "call");
  ensureKeys(o, ["stepId", "route", "tool", "kind", "args", "sig", "status", "summary", "ref"], [], "call");
  const stepId = reqText(o.stepId, "call.stepId");
  const route = reqText(o.route, "call.route");
  const tool = reqText(o.tool, "call.tool");
  const kind = oneOf(o.kind, CALL_KINDS, "call.kind");
  const status = oneOf(o.status, CALL_STATUSES, "call.status");
  const args = o.args === null ? null : checkArgs(o.args, env.limits);
  const sig = nullableText(o.sig, "call.sig");
  const summary = nullableText(o.summary, "call.summary", env.limits.summaryMax);
  const ref = nullableText(o.ref, "call.ref");

  // 5.2: `args` es null solo cuando no hay objeto que guardar (`args_invalid` por JSON no parseable).
  if (args === null && status !== "args_invalid") violation("invalid_value", 3, "call.args vale null solo con `status = args_invalid`");
  // 5.2: `sig` es null cuando no hubo argumentos resueltos (`args_invalid`, `refs_unresolved`); existe en el resto.
  if (args === null && sig !== null) violation("invalid_value", 3, "call.sig vale null cuando call.args vale null");
  if (status === "refs_unresolved" && sig !== null) violation("invalid_value", 3, "call.sig vale null con `status = refs_unresolved`");
  if (sig === null && status !== "args_invalid" && status !== "refs_unresolved") {
    violation("invalid_value", 3, `call.sig solo puede ser null con \`args_invalid\` o \`refs_unresolved\` (status = ${status})`);
  }

  if (!env.hasStep(stepId)) violation("dangling_ref", 5, `call.stepId "${stepId}" no existe`);
  if (ref !== null && !env.hasRef(ref)) violation("dangling_ref", 5, `call.ref "${ref}" no existe (primero se agrega la ref y después la llamada)`);
  return { stepId, route, tool, kind, args, sig, status, summary, ref };
}

export function checkErrorInput(raw: unknown, env: CheckEnv): ErrorInput {
  const o = ensureObject(raw, "error");
  ensureKeys(o, ["stepId", "kind"], [], "error");
  const stepId = reqText(o.stepId, "error.stepId");
  const kind = oneOf(o.kind, ERROR_KINDS, "error.kind");
  if (!env.hasStep(stepId)) violation("dangling_ref", 5, `error.stepId "${stepId}" no existe`);
  return { stepId, kind };
}

export function checkRefInput(raw: unknown, env: CheckEnv): RefInput {
  const o = ensureObject(raw, "ref");
  ensureKeys(o, ["stepId", "label", "size", "where"], [], "ref");
  const stepId = reqText(o.stepId, "ref.stepId");
  const label = reqText(o.label, "ref.label");
  const size = o.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    violation("invalid_value", 3, "ref.size debe ser un entero mayor o igual a 0 (caracteres)");
  }
  const where = reqText(o.where, "ref.where");
  if (!env.hasStep(stepId)) violation("dangling_ref", 5, `ref.stepId "${stepId}" no existe`);
  return { stepId, label, size, where };
}

// ───────────────────────── `update` ─────────────────────────

/** Campos mutables de `steps`: `state` y `superseded` (regla 4; el resto se rechaza como no mutable). */
export function checkStepPatch(raw: unknown, env: CheckEnv): StepPatch {
  const o = ensureObject(raw, "update de paso");
  for (const key of Object.keys(o)) {
    if (key !== "state" && key !== "superseded") {
      violation("not_mutable", 4, `el campo "${key}" de un paso no es mutable (solo \`state\` y \`superseded\`)`);
    }
  }
  const patch: StepPatch = {};
  if (Object.prototype.hasOwnProperty.call(o, "state")) patch.state = oneOf(o.state, STEP_STATES, "step.state");
  if (Object.prototype.hasOwnProperty.call(o, "superseded")) {
    if (typeof o.superseded !== "boolean") violation("invalid_value", 3, "step.superseded debe ser booleano");
    if (o.superseded && env.mode !== "deliberative") violation("invalid_value", 3, "`superseded` solo existe en modo deliberativo");
    patch.superseded = o.superseded;
  }
  if (patch.state === undefined && patch.superseded === undefined) {
    violation("malformed_op", 2, "el update de un paso no cambia ningún campo");
  }
  return patch;
}

/** Campos mutables de `calls`: `verdict` y `reason`, siempre juntos (regla 4). La regla de "una sola vez" está en apply.ts. */
export function checkCallPatch(raw: unknown): CallPatch {
  const o = ensureObject(raw, "update de llamada");
  for (const key of Object.keys(o)) {
    if (key !== "verdict" && key !== "reason") {
      violation("not_mutable", 4, `el campo "${key}" de una llamada no es mutable (solo \`verdict\` y \`reason\`, juntos)`);
    }
  }
  ensureKeys(o, ["verdict", "reason"], [], "update de llamada");
  const verdict = oneOf(o.verdict, CALL_VERDICTS, "call.verdict");
  const reason = nullableOneOf(o.reason, VERDICT_REASONS, "call.reason");
  if (verdict === "rejected" && reason === null) violation("invalid_value", 3, "un veredicto `rejected` requiere `reason`");
  if (verdict === "approved" && reason !== null) violation("invalid_value", 3, "`reason` solo existe con `rejected`");
  return { verdict, reason };
}

/** 5.3: se verifica toda llamada ejecutada salvo `interrupted` y `denied`. */
export function assertVerifiable(callId: string, status: CallStatus): void {
  if (!(VERIFIABLE_CALL_STATUSES as readonly string[]).includes(status)) {
    violation("transition", 6, `la llamada ${callId} (status = ${status}) no se verifica: su \`verdict\` queda null`);
  }
}

// ───────────────────────── `set` y `finish` ─────────────────────────

/** Regla 3, 5 y 7: valor del hecho (tope `factValueMax`), paso de origen existente. */
export function checkFactInput(raw: unknown, env: CheckEnv): FactInput {
  const o = ensureObject(raw, "hecho");
  ensureKeys(o, ["value", "stepId"], [], "hecho");
  const value = nullableText(o.value, "fact.value", env.limits.factValueMax);
  const stepId = reqText(o.stepId, "fact.stepId");
  if (!env.hasStep(stepId)) violation("dangling_ref", 5, `fact.stepId "${stepId}" no existe`);
  return { value, stepId };
}

export function checkResultInput(raw: unknown): ResultEntry {
  const o = ensureObject(raw, "result");
  ensureKeys(o, ["text", "origin"], [], "result");
  return { text: reqText(o.text, "result.text"), origin: oneOf(o.origin, RESULT_ORIGINS, "result.origin") };
}

export function checkFinishValue(raw: unknown): FinishValue {
  const o = ensureObject(raw, "finish");
  ensureKeys(o, ["state", "stopReason"], [], "finish");
  return {
    state: oneOf(o.state, TERMINAL_TASK_STATES, "finish.state"),
    stopReason: nullableOneOf(o.stopReason, STOP_REASONS, "finish.stopReason"),
  };
}

/** `meta` es opcional, opaco y categórico: se exige solo que sea un objeto plano de valores primitivos. */
export function checkMeta(raw: unknown): ChangeMeta | null {
  if (raw === undefined || raw === null) return null;
  const o = ensureObject(raw, "meta");
  const copy: Record<string, string | number | boolean | null> = {};
  for (const key of Object.keys(o)) {
    const v = o[key];
    const primitive = v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
    if (!primitive) violation("invalid_value", 3, `meta.${key} debe ser un valor primitivo (meta es categórico, sin estructura ni prosa)`);
    copy[key] = v as string | number | boolean | null;
  }
  return copy;
}