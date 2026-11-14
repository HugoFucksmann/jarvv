/**
 * JARVIS Core — Los topes del motor, en un solo lugar.
 *
 * Cada tope es un número de `BUDGET` y una regla de qué se cuenta y a qué alcance. Antes las reglas estaban repartidas (en `retries.ts`, en
 * `stepLoop.ts`, en `runTask.ts` y en `callRunner.ts`), con comparaciones distintas (`>` y `>=`) y contando cosas diferentes con nombres parecidos.
 * Aquí quedan juntas, y `runStep` consulta UN punto de control (`checkStepLimits`).
 *
 * Alcances:
 * - `task`: se cuenta en toda la tarea (pasos, escalaciones, replans).
 * - `item`: por ítem de la lista de pendientes del reactivo (lo lleva `runReactive`: el ítem no vive en el contexto).
 * - `step`: se cuenta entre las llamadas del paso y arranca de cero en cada paso nuevo.
 *
 * Qué es una llamada, a efectos de los topes (todo se deriva de `calls`; no hay contadores aparte):
 * - **Ejecución** (`executions`): la llamada llegó a la herramienta. Es lo que cuesta de verdad (tiempo, efectos).
 * - **Intento** (`attempts`): cualquier llamada registrada salvo `user_rejected` (el rechazo es decisión del usuario, no un intento del modelo).
 *   Incluye lo que nunca tocó la herramienta: `loop_blocked`, `args_invalid`, `refs_unresolved`, `info_missing`, `tool_rejected`.
 * Así, una repetición bloqueada no gasta una ejecución, y los intentos tienen su propio techo contra un modelo que da vueltas.
 */

import { BUDGET } from "../budget.ts";
import { isExecuted } from "../ctx/index.ts";
import type { Call, TaskContext } from "../ctx/index.ts";
import type { StepFailureCause } from "./outcomes.ts";

// ───────────────────────── Catálogo de topes ─────────────────────────

export type LimitScope = "task" | "item" | "step";

/** Los topes de `BUDGET` que gobiernan el motor, con su alcance. El orden es el de `GET /limits`. */
export const LIMIT_SCOPES = {
  maxSteps: "task",
  maxReplans: "task",
  maxEscalations: "task",
  maxItemFailures: "item",
  maxCallsPerStep: "step",
  maxAttemptsPerStep: "step",
  maxRepeatsPerStep: "step",
  maxReviewRejectionsPerStep: "step",
  maxVerifyRejectionsPerStep: "step",
  maxUserRejectionsPerStep: "step",
  maxDeniedPerStep: "step",
  maxQuestionsPerStep: "step",
  maxProcessPromptsPerStep: "step",
  maxNotAccomplishedPerRoute: "step",
} as const satisfies Record<string, LimitScope>;

export type LimitId = keyof typeof LIMIT_SCOPES;

/** Valor de cada tope, para `GET /limits` (la interfaz muestra el progreso contra estos números). */
export function limitValues(): Record<LimitId, number> {
  const out = {} as Record<LimitId, number>;
  for (const id of Object.keys(LIMIT_SCOPES) as LimitId[]) out[id] = BUDGET[id];
  return out;
}

// ───────────────────────── Topes de la tarea y del ítem ─────────────────────────

/** Pasos de la tarea (los `failed` cuentan): al llegar, la tarea cierra `max_steps`. */
export const stepsExhausted = (ctx: TaskContext): boolean => ctx.find("steps", {}).length >= BUDGET.maxSteps;

/** Escalaciones (pasos `failed`) por ENCIMA del tope: el reactivo cierra `no_alternatives`. */
export const escalationsExceeded = (ctx: TaskContext): boolean => ctx.escalations() > BUDGET.maxEscalations;

/** Replans hechos al tope: el deliberativo cierra `replans_exhausted`. */
export const replansExhausted = (ctx: TaskContext): boolean => ctx.replansDone() >= BUDGET.maxReplans;

/** Pasos fallidos seguidos sobre un mismo ítem al tope: el reactivo lo abandona si quedan otros. */
export const itemFailuresReached = (failures: number): boolean => failures >= BUDGET.maxItemFailures;

// ───────────────────────── Topes del paso ─────────────────────────

/** Lo que se cuenta de las llamadas de un paso. */
export interface StepCounters {
  /** Llegaron a la herramienta. */
  readonly executions: number;
  /** Todas las registradas salvo `user_rejected`. */
  readonly attempts: number;
  /** `loop_blocked`. */
  readonly blocked: number;
  /** `args_invalid`: del pre-chequeo, de la revisión (D3) o de la generación de argumentos. */
  readonly argsInvalid: number;
  /** `user_rejected`. */
  readonly userRejected: number;
  /** `tool_rejected` (Guard o lista negra) y `denied` (servidor). */
  readonly denied: number;
  /** Llamadas con veredicto `rejected` de la verificación (incluye `tool_error` y `exception`, que se rechazan sin modelo). */
  readonly rejected: number;
}

/** Los contadores del paso, en una sola pasada por sus llamadas. */
export function countStep(calls: readonly Call[]): StepCounters {
  let executions = 0;
  let attempts = 0;
  let blocked = 0;
  let argsInvalid = 0;
  let userRejected = 0;
  let denied = 0;
  let rejected = 0;
  for (const c of calls) {
    if (isExecuted(c)) executions++;
    if (c.status === "user_rejected") userRejected++;
    else attempts++;
    if (c.status === "loop_blocked") blocked++;
    else if (c.status === "args_invalid") argsInvalid++;
    else if (c.status === "tool_rejected" || c.status === "denied") denied++;
    if (c.verdict === "rejected") rejected++;
  }
  return { executions, attempts, blocked, argsInvalid, userRejected, denied, rejected };
}

/** Una regla del paso: cuando `counter` llega a `BUDGET[limit]`, el paso falla con `cause`. */
interface StepRule {
  readonly limit: LimitId;
  readonly counter: keyof StepCounters;
  readonly cause: StepFailureCause;
  /** Antes de fallar, se le pregunta al usuario (si todavía se puede): un atasco puede deberse a algo que solo él sabe. */
  readonly askFirst: boolean;
}

/** En orden de precedencia: la primera que se cumple decide la causa. Agregar un tope del paso es agregar una fila. */
const STEP_RULES: readonly StepRule[] = [
  { limit: "maxRepeatsPerStep", counter: "blocked", cause: "repeat_blocked", askFirst: false },
  { limit: "maxUserRejectionsPerStep", counter: "userRejected", cause: "user_rejected", askFirst: false },
  { limit: "maxDeniedPerStep", counter: "denied", cause: "denied", askFirst: false },
  { limit: "maxReviewRejectionsPerStep", counter: "argsInvalid", cause: "review_rejected", askFirst: false },
  { limit: "maxVerifyRejectionsPerStep", counter: "rejected", cause: "verify_rejected", askFirst: false },
  { limit: "maxCallsPerStep", counter: "executions", cause: "call_cap", askFirst: true },
  { limit: "maxAttemptsPerStep", counter: "attempts", cause: "call_cap", askFirst: true },
];

export interface StepLimitHit {
  readonly limit: LimitId;
  readonly cause: StepFailureCause;
  readonly askFirst: boolean;
}

/** El punto de control del paso: el primer tope alcanzado, o `null` si el paso puede seguir. */
export function checkStepLimits(ctx: TaskContext, stepId: string): StepLimitHit | null {
  const counters = countStep(ctx.find("calls", { stepId }));
  for (const rule of STEP_RULES) {
    if (counters[rule.counter] >= BUDGET[rule.limit]) return { limit: rule.limit, cause: rule.cause, askFirst: rule.askFirst };
  }
  return null;
}

/** Rechazos `not_accomplished` de Decisión 4 que agotan una ruta en un paso: deja de ofrecerse a Decisión 1 en ese paso. */
export function routeExhausted(ctx: TaskContext, stepId: string, route: string): boolean {
  const rejected = ctx.find("calls", { stepId, route }).filter((c) => c.verdict === "rejected" && c.reason === "not_accomplished").length;
  return rejected >= BUDGET.maxNotAccomplishedPerRoute;
}
