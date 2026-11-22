/**
 * JARVIS Core — Los topes del motor, en un solo lugar.
 *
 * Cada tope es un número de `BUDGET` y una regla de qué se cuenta y a qué alcance. Antes las reglas estaban repartidas (en `retries.ts`, en
 * `stepLoop.ts`, en `runTask.ts` y en `callRunner.ts`), con comparaciones distintas (`>` y `>=`) y contando cosas diferentes con nombres parecidos.
 * Aquí quedan juntas, y `runStep` consulta UN punto de control (`checkStepLimits`).
 *
 * Alcances:
 * - `task`: se cuenta en toda la tarea (pasos, replans) o en una racha de ella (pasos fallidos seguidos).
 * - `step`: se cuenta entre las llamadas del paso y arranca de cero en cada paso nuevo.
 *
 * Qué es una llamada, a efectos de los topes (todo se deriva de `calls`; no hay contadores aparte):
 * - **Ejecución** (`executions`): la llamada llegó a la herramienta. Es lo que cuesta de verdad (tiempo, efectos).
 * - **Intento** (`attempts`): cualquier llamada registrada salvo `user_rejected` (el rechazo es decisión del usuario, no un intento del modelo).
 *   Incluye lo que nunca tocó la herramienta: `loop_blocked`, `args_invalid`, `info_missing`, `tool_rejected`.
 * Así, una repetición bloqueada no gasta una ejecución, y los intentos tienen su propio techo contra un modelo que da vueltas.
 */

import { BUDGET } from "../budget.ts";
import { isExecuted } from "../ctx/index.ts";
import type { Call, TaskContext } from "../ctx/index.ts";
import type { StepFailureCause } from "./outcomes.ts";

// ───────────────────────── Catálogo de topes ─────────────────────────

export type LimitScope = "task" | "step";

/** Los topes de `BUDGET` que gobiernan el motor, con su alcance. El orden es el de `GET /limits`. */
export const LIMIT_SCOPES = {
  maxSteps: "task",
  maxReplans: "task",
  maxEscalations: "task",
  maxCallsPerStep: "step",
  maxAttemptsPerStep: "step",
  maxRepeatsPerStep: "step",
  maxReviewRejectionsPerStep: "step",
  maxVerifyRejectionsPerStep: "step",
  maxToolErrorsPerStep: "step",
  maxSameToolErrorsPerStep: "step",
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

/**
 * Pasos `failed` SEGUIDOS (sin un paso completado en el medio) por ENCIMA del tope: el reactivo cierra `no_alternatives`. Cuenta la racha y no el total de la tarea: un paso que
 * termina bien la reinicia, así una tarea larga que se recupera de fallos sueltos no se cierra por acumularlos.
 */
export const escalationsExceeded = (ctx: TaskContext): boolean => ctx.consecutiveFailures() > BUDGET.maxEscalations;

/** Replans hechos al tope: el deliberativo cierra `replans_exhausted`. */
export const replansExhausted = (ctx: TaskContext): boolean => ctx.replansDone() >= BUDGET.maxReplans;

// ───────────────────────── Topes del paso ─────────────────────────

/**
 * La «firma» de un error de herramienta: su texto sin lo que cambia entre dos corridas del mismo error, en minúsculas y con los espacios colapsados. Dos errores con
 * la misma firma son el mismo error. Lo que no cuenta:
 * - el `pid` y la duración de una llamada de `run_command`;
 * - las líneas que PowerShell agrega con la posición y el texto del comando que falló (`En línea: 1 Carácter: 1`, `At line:1 char:1`, `+ Get-X -Online | Where-Object …`,
 *   `+ ~~~~`): cuando el modelo cambia el comando para reintentar, el error (por ejemplo «requiere elevación») es el mismo pero esas líneas no, y la guarda de «el
 *   mismo error dos veces» nunca disparaba.
 */
export function toolErrorSignature(summary: string | null): string {
  return (summary ?? "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\+(\s|$)/.test(line) && !/^\s*(en línea|at line)\s*:/i.test(line))
    .join("\n")
    .toLowerCase()
    .replace(/\bpid: ?\d+/g, "")
    .replace(/\bduration: ?[\d.]+ ?m?s\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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
  /** Llamadas con veredicto `rejected` de la verificación: el resultado no sirve (`no_data`, `not_accomplished`, las sondas). No incluye los errores de la herramienta. */
  readonly rejected: number;
  /** Errores de la herramienta: `tool_error` y `exception`. Se rechazan sin consultar al modelo, pero cuentan aparte de los rechazos de la verificación. */
  readonly toolFailed: number;
  /** Cuántos errores de la herramienta SEGUIDOS (entre los errores del paso, en orden) tienen la misma firma que el último: 1 si el último error es distinto del anterior. */
  readonly sameToolError: number;
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
  let toolFailed = 0;
  let sameToolError = 0;
  let lastSignature: string | null = null;
  for (const c of calls) {
    if (isExecuted(c)) executions++;
    if (c.status === "user_rejected") userRejected++;
    else attempts++;
    if (c.status === "loop_blocked") blocked++;
    else if (c.status === "args_invalid") argsInvalid++;
    else if (c.status === "tool_rejected" || c.status === "denied") denied++;
    // Una escritura que no halló la ruta (`not_found`) falla igual que un error de la herramienta: el generador ve el motivo y puede corregirla.
    if (c.status === "tool_error" || c.status === "exception" || (c.status === "not_found" && c.kind === "write")) {
      toolFailed++;
      const signature = toolErrorSignature(c.summary);
      sameToolError = signature === lastSignature ? sameToolError + 1 : 1;
      lastSignature = signature;
    } else if (c.verdict === "rejected") rejected++;
  }
  return { executions, attempts, blocked, argsInvalid, userRejected, denied, rejected, toolFailed, sameToolError };
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
  { limit: "maxToolErrorsPerStep", counter: "toolFailed", cause: "tool_failed", askFirst: false },
  { limit: "maxSameToolErrorsPerStep", counter: "sameToolError", cause: "tool_failed", askFirst: false },
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
