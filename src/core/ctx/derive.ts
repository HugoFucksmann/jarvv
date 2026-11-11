/**
 * Derivaciones (5.4 "Se deriva, no se guarda"): funciones puras de solo lectura sobre los datos del contexto.
 * Nada se guarda: cada llamada recalcula desde `calls`, `steps`, `plans` y `facts`. Reutilizan `closure.ts`
 * (`isEffect`, `canFinish`, `planClosure`, `hasApprovedCall`).
 *
 * El contexto no conoce herramientas (principio 5): `isRepeat` recibe la política de repetición ya resuelta.
 */

import { isEffect } from "./closure.ts";
import { violation } from "./errors.ts";
import { EXECUTED_CALL_STATUSES } from "./types.ts";
import type { Call, CallStatus, ContextData, Fact, Plan, Step } from "./types.ts";

// ───────────────────────── Predicados de llamada ─────────────────────────

/** Estados de una escritura que pudo dejar cambios parciales (5.4, posibles efectos). */
const POSSIBLE_EFFECT_STATUSES: readonly CallStatus[] = ["tool_error", "exception", "interrupted", "waiting_input"];

/** Fallo transitorio: la herramienta pudo fallar por algo pasajero, o la ejecución no terminó. */
export function isTransientFailure(call: Call): boolean {
  return POSSIBLE_EFFECT_STATUSES.includes(call.status);
}

/** Posible efecto (5.4): `write` con `tool_error`, `exception` o `interrupted`; pudo dejar cambios parciales. */
export function isPossibleEffect(call: Call): boolean {
  return call.kind === "write" && POSSIBLE_EFFECT_STATUSES.includes(call.status);
}

/**
 * Ejecutada (5.3): llegó a despacharse a la herramienta. Un `denied` cuenta como ejecutada: si fue del Guard la tarea
 * ya cerró con `security_denied`, así que el único `denied` que sigue vivo es el del servidor.
 */
export function isExecuted(call: Call): boolean {
  return call.status === "denied" || (EXECUTED_CALL_STATUSES as readonly string[]).includes(call.status);
}

/** Aprobada por la verificación (5.4, hechas). */
export function isApproved(call: Call): boolean {
  return call.verdict === "approved";
}

/** Fallo de llamada: `status` distinto de `ok` (incluye `no_data` y `not_found`) o `verdict = rejected`. */
export function isFailure(call: Call): boolean {
  return call.status !== "ok" || call.verdict === "rejected";
}

/** Los últimos `size` elementos, en el mismo orden. */
export function lastN<T>(items: readonly T[], size: number): T[] {
  if (size <= 0) return [];
  return items.length <= size ? items.slice() : items.slice(items.length - size);
}

// ───────────────────────── Efectos, hechas e intentos ─────────────────────────

/** Efectos (5.4): sin tope. */
export function effectsOf(calls: readonly Call[]): Call[] {
  return calls.filter(isEffect);
}

/** Posibles efectos (5.4): se muestran aparte; no cuentan como efecto para el anti-loop ni el cierre. */
export function possibleEffectsOf(calls: readonly Call[]): Call[] {
  return calls.filter(isPossibleEffect);
}

/** Hechas (`done`, 5.4): llamadas con `verdict = approved`, de cualquier `status`. */
export function doneCalls(calls: readonly Call[]): Call[] {
  return calls.filter(isApproved);
}

/**
 * Intentos (`attempts`, 5.4): llamadas con `verdict` distinto de `approved` (fallos de cualquier `status`, rechazadas,
 * no ejecutadas y sin verificar). Con `stepId`, los del paso.
 */
export function attemptCalls(calls: readonly Call[], stepId?: string): Call[] {
  return calls.filter((c) => !isApproved(c) && (stepId === undefined || c.stepId === stepId));
}

/** Fallos de llamada recientes; con `stepId`, los del paso. */
export function recentFailures(calls: readonly Call[], size: number, stepId?: string): Call[] {
  return lastN(
    calls.filter((c) => isFailure(c) && (stepId === undefined || c.stepId === stepId)),
    size,
  );
}

/** Últimas lecturas con datos (5.4): `kind = read`, `status = ok` y `verdict = approved`. */
export function lastReadsWithData(calls: readonly Call[], size: number): Call[] {
  return lastN(
    calls.filter((c) => c.kind === "read" && c.status === "ok" && isApproved(c)),
    size,
  );
}

/** Último resultado (`lastResult`, 5.4): la última llamada aprobada que no es efecto; `null` si no hay. */
export function lastResultOf(calls: readonly Call[]): Call | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (isApproved(c) && !isEffect(c)) return c;
  }
  return null;
}

/**
 * Resultado de un paso (`outcome`, 5.4): la llamada aprobada del paso, solo si es una lectura (las escrituras ya se ven
 * como efectos). El recorte del `summary` lo hace la vista.
 */
export function outcomeOf(calls: readonly Call[], stepId: string): Call | null {
  for (const c of calls) {
    if (c.stepId === stepId && isApproved(c)) return c.kind === "read" ? c : null;
  }
  return null;
}

// ───────────────────────── Hechos: usuario y entorno ─────────────────────────

/** Prefijo de los hechos con la respuesta del usuario: `answer_<stepId>_<n>` (5.2). */
export const ANSWER_FACT_PREFIX = "answer_";

export function isAnswerKey(key: string): boolean {
  return key.startsWith(ANSWER_FACT_PREFIX);
}

/** Preguntas ya hechas en un paso: hechos `answer_*` de ese paso, incluidos los retirados (la clave sigue ocupada). */
export function questionsAsked(facts: { readonly [key: string]: Fact }, stepId: string): number {
  let count = 0;
  for (const key of Object.keys(facts)) {
    if (isAnswerKey(key) && facts[key].stepId === stepId) count++;
  }
  return count;
}

/** Clave del hecho con la respuesta a la siguiente pregunta del paso: `answer_<stepId>_<n>` (5.2). */
export function nextAnswerKey(facts: { readonly [key: string]: Fact }, stepId: string): string {
  return `${ANSWER_FACT_PREFIX}${stepId}_${questionsAsked(facts, stepId) + 1}`;
}

export interface UserInputEntry {
  /** `answer`: respuesta a una pregunta (hecho `answer_*`). `rejection`: instrucción al rechazar una mutación. */
  readonly kind: "answer" | "rejection";
  readonly stepId: string;
  readonly text: string;
  readonly at: number;
}

/**
 * Entrada del usuario (`userInput`, 5.4): hechos `answer_*` vigentes y `summary` de las llamadas `user_rejected` con
 * instrucción, en orden cronológico.
 */
export function userInputOf(data: Pick<ContextData, "calls" | "facts">): UserInputEntry[] {
  const out: UserInputEntry[] = [];
  for (const key of Object.keys(data.facts)) {
    const fact = data.facts[key];
    if (isAnswerKey(key) && fact.value !== null) out.push({ kind: "answer", stepId: fact.stepId, text: fact.value, at: fact.at });
  }
  for (const c of data.calls) {
    if (c.status === "user_rejected" && c.summary !== null) out.push({ kind: "rejection", stepId: c.stepId, text: c.summary, at: c.at });
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface EnvEntry {
  readonly key: string;
  readonly value: string;
  readonly stepId: string;
  readonly at: number;
}

/** Hechos de entorno (`env`, 5.4): hechos vigentes que no son `answer_*` (hoy, solo `process`). */
export function envOf(facts: { readonly [key: string]: Fact }): EnvEntry[] {
  const out: EnvEntry[] = [];
  for (const key of Object.keys(facts)) {
    const fact = facts[key];
    if (!isAnswerKey(key) && fact.value !== null) out.push({ key, value: fact.value, stepId: fact.stepId, at: fact.at });
  }
  return out.sort((a, b) => a.at - b.at);
}

// ───────────────────────── Contadores ─────────────────────────

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

/**
 * Política de repetición de una herramienta (`repeat` del catálogo, resuelta por quien ejecuta):
 * - `strict` (por defecto): una lectura idéntica a una ya hecha se bloquea (ver `isRepeat` para las excepciones).
 * - `retry_failed`: además, tras un resultado fallido (`tool_error`, `no_data`, `not_found`...) se permite un reintento idéntico por paso.
 *   Para herramientas cuyo resultado puede cambiar entre dos llamadas iguales (la web).
 * - `allow`: nunca se bloquea (sondeos repetidos de una misma salida).
 */
export type RepeatPolicy = "strict" | "retry_failed" | "allow";

export interface RepeatOptions {
  readonly policy: RepeatPolicy;
  /** Paso desde el que se pide la llamada: un rechazo de la verificación vale solo dentro del paso que lo emitió. */
  readonly stepId: string;
}

/** Marca de tiempo del hecho `answer_*` más reciente (cualquier valor, incluido `null`); `-Infinity` si no hay. */
function latestAnswerAt(facts: { readonly [key: string]: Fact }): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const key of Object.keys(facts)) {
    if (isAnswerKey(key) && facts[key].at > latest) latest = facts[key].at;
  }
  return latest;
}

/**
 * Llamada repetida (5.4): ¿ejecutar `tool` con `sig` repite la llamada ejecutada idéntica más reciente?
 *
 * Se comparan herramienta y `sig` entre las llamadas ejecutadas de toda la tarea (un `denied` del servidor cuenta como ejecutada). Manda
 * la idéntica más reciente (`previous`) y su `kind`. `policy = allow` o `sig = null`: `false`, sin comparar.
 *
 * Primero, el orden (igual para cualquier política):
 * - Lectura idéntica: se bloquea salvo una escritura `ok` intermedia (cambió el mundo).
 * - Escritura idéntica: se bloquea salvo una lectura ejecutada intermedia; vale también si la anterior falló, porque pudo dejar cambios parciales.
 * - Un hecho `answer_*` escrito después de la idéntica (`fact.at > previous.at`) cuenta como intermedio en ambos casos.
 *
 * Después, y solo para LECTURAS (una escritura que falló no se reintenta a ciegas), qué resultado previo permite repetir:
 * - `previous` aprobada por la verificación: se bloquea en toda la tarea (el dato ya se obtuvo y está a la vista).
 * - `previous` rechazada por la verificación (el resultado llegó pero no sirvió): vale **solo para su criterio**. Es un juicio contra la
 *   instrucción y lo esperado de ese paso; un paso con OTRO criterio puede aprobar lo que aquel rechazó. Dentro del mismo paso, o en otro paso
 *   que pide lo mismo (el reactivo reintenta un ítem con un paso nuevo), repetir da el mismo veredicto.
 * - `previous` fallida por algo pasajero (`tool_error`, `exception`, `interrupted`): se permite **un** reintento idéntico por paso. Con `retry_failed`,
 *   también tras `no_data` y `not_found`. En otro paso, siempre.
 * - `previous` `denied` (política del servidor): se bloquea.
 */
export function isRepeat(
  data: Pick<ContextData, "calls" | "facts" | "steps">,
  tool: string,
  sig: string | null,
  options: RepeatOptions,
): boolean {
  if (options.policy === "allow" || sig === null) return false;
  const calls = data.calls;
  let sawEffect = false;
  let sawRead = false;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (c.tool === tool && c.sig === sig && isExecuted(c)) {
      if (latestAnswerAt(data.facts) > c.at) return false;
      const blockedByOrder = c.kind === "read" ? !sawEffect : !sawRead;
      if (!blockedByOrder) return false;
      return c.kind === "read" ? !mayRepeatRead(data.steps, calls, c, tool, sig, options) : true;
    }
    if (isEffect(c)) sawEffect = true;
    if (c.kind === "read" && isExecuted(c)) sawRead = true;
  }
  return false;
}

/** Dos pasos tienen el mismo criterio si piden lo mismo (instrucción y lo esperado): reintentar un ítem con otro paso no cambia lo que se juzga. */
function sameCriterion(steps: readonly Step[], a: string, b: string): boolean {
  const first = steps.find((s) => s.id === a);
  const second = steps.find((s) => s.id === b);
  return first !== undefined && second !== undefined && first.instruction === second.instruction && first.expected === second.expected;
}

/** ¿Lo ocurrido con la lectura idéntica anterior (`previous`) permite repetirla? Ver `isRepeat`. */
function mayRepeatRead(steps: readonly Step[], calls: readonly Call[], previous: Call, tool: string, sig: string, options: RepeatOptions): boolean {
  if (previous.verdict === "approved" || previous.status === "denied") return false;
  const retriable = isTransientFailure(previous) || (options.policy === "retry_failed" && previous.status !== "ok");
  if (previous.stepId !== options.stepId) {
    // Otro paso: un resultado rechazado se juzgó contra el criterio de aquel; solo si el de este es otro puede salir distinto.
    const rejectedUnderAnotherCriterion = previous.status === "ok" && previous.verdict === "rejected" && !sameCriterion(steps, previous.stepId, options.stepId);
    return rejectedUnderAnotherCriterion || retriable;
  }
  if (!retriable) return false;
  // Un reintento por paso: si ya hay dos ejecuciones idénticas en este paso, el reintento ya se usó.
  const inStep = calls.filter((c) => c.stepId === options.stepId && c.tool === tool && c.sig === sig && isExecuted(c)).length;
  return inStep < 2;
}
