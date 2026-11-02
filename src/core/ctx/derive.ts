/**
 * Derivaciones (5.4 "Se deriva, no se guarda"): funciones puras de solo lectura sobre los datos del contexto.
 * Nada se guarda: cada llamada recalcula desde `calls`, `steps`, `plans` y `facts`. Reutilizan `closure.ts`
 * (`isEffect`, `canFinish`, `planClosure`, `hasApprovedCall`) y `query.ts` (`currentOf`).
 *
 * El contexto no conoce herramientas (principio 5): `isRepeat` recibe la exención ya resuelta.
 */

import { isEffect } from "./closure.ts";
import { violation } from "./errors.ts";
import { currentOf } from "./query.ts";
import { EXECUTED_CALL_STATUSES } from "./types.ts";
import type { Call, CallKind, CallStatus, ContextData, Fact, Plan, Step } from "./types.ts";

// ───────────────────────── Predicados de llamada ─────────────────────────

/** Fallos transitorios (5.4): la herramienta pudo fallar por algo pasajero, o la ejecución no terminó. */
const TRANSIENT_STATUSES: readonly CallStatus[] = ["tool_error", "exception", "interrupted"];

export function isTransientFailure(call: Call): boolean {
  return TRANSIENT_STATUSES.includes(call.status);
}

/** Posible efecto (5.4): `write` con `tool_error`, `exception` o `interrupted`; pudo dejar cambios parciales. */
export function isPossibleEffect(call: Call): boolean {
  return call.kind === "write" && isTransientFailure(call);
}

/**
 * Ejecutada (5.3): llegó a despacharse a la herramienta. Un `denied` cuenta como ejecutada (v0.28): si fue del Guard
 * la tarea ya cerró con `security_denied`, así que el único `denied` que sigue vivo es el del servidor.
 */
export function isExecuted(call: Call): boolean {
  return call.status === "denied" || (EXECUTED_CALL_STATUSES as readonly string[]).includes(call.status);
}

/** Fallo de llamada (5.4): `status` distinto de `ok` (incluye `no_data` y `not_found`) o `verdict = rejected`. */
export function isFailure(call: Call): boolean {
  return call.status !== "ok" || call.verdict === "rejected";
}

/** Los últimos `size` elementos, en el mismo orden. */
export function lastN<T>(items: readonly T[], size: number): T[] {
  if (size <= 0) return [];
  return items.length <= size ? items.slice() : items.slice(items.length - size);
}

// ───────────────────────── Efectos y fallos ─────────────────────────

/** Efectos (5.4): sin tope. */
export function effectsOf(calls: readonly Call[]): Call[] {
  return calls.filter(isEffect);
}

/** Posibles efectos (5.4): se muestran aparte; no cuentan como efecto para el anti-loop ni el cierre. */
export function possibleEffectsOf(calls: readonly Call[]): Call[] {
  return calls.filter(isPossibleEffect);
}

/** Fallos de llamada recientes (5.4); con `stepId`, los del paso (fallos del paso actual). */
export function recentFailures(calls: readonly Call[], size: number, stepId?: string): Call[] {
  return lastN(
    calls.filter((c) => isFailure(c) && (stepId === undefined || c.stepId === stepId)),
    size,
  );
}

/** Últimas lecturas con datos (5.4): `kind = read`, `status = ok`. */
export function lastReadsWithData(calls: readonly Call[], size: number): Call[] {
  return lastN(
    calls.filter((c) => c.kind === "read" && c.status === "ok"),
    size,
  );
}

// ───────────────────────── Contadores ─────────────────────────

/** Reintentos de argumentos de un paso (5.4, provisorio): llamadas del paso con `status = args_invalid`. */
export function argsRetries(calls: readonly Call[], stepId: string): number {
  return calls.filter((c) => c.stepId === stepId && c.status === "args_invalid").length;
}

/** Reintentos de resultado de un paso (5.4, provisorio): llamadas del paso con `verdict = rejected`. */
export function resultRetries(calls: readonly Call[], stepId: string): number {
  return calls.filter((c) => c.stepId === stepId && c.verdict === "rejected").length;
}

/** Llamadas de un paso para el tope (5.4, provisorio): sin `user_rejected`. */
export function callsInStep(calls: readonly Call[], stepId: string): number {
  return calls.filter((c) => c.stepId === stepId && c.status !== "user_rejected").length;
}

/** Replans realizados (5.4): `plans` con `trigger = step_failure`. */
export function replansDone(plans: readonly Plan[]): number {
  return plans.filter((p) => p.trigger === "step_failure").length;
}

/** Escalaciones (5.4): pasos `failed`, incluidos los `superseded`. */
export function escalationCount(steps: readonly Step[]): number {
  return steps.filter((s) => s.state === "failed").length;
}

/**
 * Tamaño de las ventanas recientes (9): con 0, 1 y 2 o más escalaciones (`min(escalaciones, 2)`, en ambos modos)
 * las vistas muestran los últimos `windows[0]`, `windows[1]` y `windows[2]` elementos de cada lista. `windows` lo
 * pasa quien usa el contexto (`BUDGET.recentWindows`).
 */
export function recentWindowSize(steps: readonly Step[], windows: readonly number[]): number {
  if (windows.length === 0) violation("invalid_value", null, "`recentWindows` no puede estar vacío");
  const level = Math.min(escalationCount(steps), 2, windows.length - 1);
  return windows[level];
}

// ───────────────────────── Anti-loop ─────────────────────────

export interface RepeatOptions {
  /** La herramienta está exenta del anti-loop (`loopExempt` del catálogo, resuelto por quien ejecuta). */
  readonly exempt: boolean;
}

/** Marca de tiempo del hecho `answer_*` más reciente (cualquier valor, incluido `null`); `-Infinity` si no hay. */
function latestAnswerAt(facts: { readonly [key: string]: Fact }): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const key of Object.keys(facts)) {
    if (key.startsWith("answer_") && facts[key].at > latest) latest = facts[key].at;
  }
  return latest;
}

/**
 * Llamada repetida (5.4): ¿ejecutar `tool` con `sig` repite una llamada ejecutada anterior?
 *
 * - `exempt = true` o `sig = null`: `false`, sin comparar.
 * - Se comparan herramienta y `sig` entre las llamadas ejecutadas de toda la tarea (un `denied` del servidor cuenta
 *   como ejecutada); el `kind` es el de la llamada idéntica más reciente.
 * - Lectura idéntica: se bloquea, salvo un único reintento tras un fallo transitorio (`tool_error`, `exception`,
 *   `interrupted`) o que haya una escritura `ok` intermedia.
 * - Escritura idéntica: se bloquea salvo que haya una lectura (ejecutada) intermedia; vale también si la anterior
 *   falló, porque pudo dejar cambios parciales.
 * - Un hecho `answer_*` escrito después de una llamada (`fact.at > call.at`) cuenta como intermedio en ambos casos.
 *
 * Las idénticas "sin separar" son las posteriores al último intermedio; el único reintento se concede cuando hay
 * exactamente una y fue transitoria.
 */
export function isRepeat(
  data: Pick<ContextData, "calls" | "facts">,
  tool: string,
  sig: string | null,
  options: RepeatOptions,
): boolean {
  if (options.exempt || sig === null) return false;
  const calls = data.calls;
  const identical = (c: Call): boolean => c.tool === tool && c.sig === sig && isExecuted(c);

  let found: CallKind | null = null;
  for (let i = calls.length - 1; i >= 0; i--) {
    if (identical(calls[i])) {
      found = calls[i].kind;
      break;
    }
  }
  if (found === null) return false;
  const kind: CallKind = found;

  const isIntermediate = (c: Call): boolean => (kind === "read" ? isEffect(c) : c.kind === "read" && isExecuted(c));
  const answerAt = latestAnswerAt(data.facts);

  let separated = false;
  let unseparated = 0;
  let newest: Call | null = null;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (identical(c)) {
      if (separated || answerAt > c.at) break;
      unseparated++;
      if (newest === null) newest = c;
    } else if (isIntermediate(c)) {
      separated = true;
    }
  }

  if (newest === null || unseparated === 0) return false;
  if (kind === "read" && unseparated === 1 && isTransientFailure(newest)) return false;
  return true;
}

// ───────────────────────── Handoff ─────────────────────────

export interface Handoff {
  /** Paso anterior que entrega el resultado. */
  stepId: string;
  /** Llamada cuyo `summary` se entrega. */
  callId: string;
  summary: string;
  /** Id de la ref de esa llamada, si el resumen no tenía el resultado completo. */
  ref: string | null;
}

/**
 * Handoff (5.4, provisorio): el paso vigente inmediato anterior al paso actual, solo si está `completed`;
 * entrega el `summary` de su última llamada con `verdict = approved` y resumen no nulo. `null` si no aplica.
 */
export function handoffOf(data: ContextData): Handoff | null {
  const current = currentOf(data).step;
  if (current === null) return null;
  let previous: Step | null = null;
  for (const step of data.steps) {
    if (step.id === current.id) break;
    if (!step.superseded) previous = step;
  }
  if (previous === null || previous.state !== "completed") return null;
  for (let i = data.calls.length - 1; i >= 0; i--) {
    const call = data.calls[i];
    if (call.stepId === previous.id && call.verdict === "approved" && call.summary !== null) {
      return { stepId: previous.id, callId: call.id, summary: call.summary, ref: call.ref };
    }
  }
  return null;
}
