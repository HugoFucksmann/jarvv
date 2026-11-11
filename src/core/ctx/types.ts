/**
 * Esquema y vocabularios del contexto (PLAN_CONTEXT.md v0.38, secciones 5 y 6).
 * Solo tipos y constantes de vocabulario: sin lógica.
 */

export const CONTEXT_VERSION = 1 as const;

// ───────────────────────── Vocabularios (5.3) ─────────────────────────

export const TASK_MODES = ["reactive", "deliberative"] as const;
export type TaskMode = (typeof TASK_MODES)[number];

export const TASK_STATES = ["running", "completed", "partial", "failed", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** Estados terminales: los cuatro últimos de `task.state`. */
export const TERMINAL_TASK_STATES = ["completed", "partial", "failed", "cancelled"] as const;
export type TerminalTaskState = (typeof TERMINAL_TASK_STATES)[number];

export const STOP_REASONS = [
  "max_steps",
  "no_alternatives",
  "security_denied",
  "user_cancelled",
  "replans_exhausted",
  "unrecoverable",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export const PLAN_TRIGGERS = ["initial", "user_feedback", "step_failure"] as const;
export type PlanTrigger = (typeof PLAN_TRIGGERS)[number];

export const STEP_STATES = ["pending", "running", "completed", "failed"] as const;
export type StepState = (typeof STEP_STATES)[number];

export const CALL_KINDS = ["read", "write"] as const;
export type CallKind = (typeof CALL_KINDS)[number];

/**
 * Llamadas ejecutadas: llegaron a despacharse a la herramienta (5.3). `waiting_input`: el proceso que lanzó sigue vivo y pide una respuesta del usuario; no se verifica
 * (no hay resultado que juzgar) y el bucle de paso se la pregunta al usuario.
 */
export const EXECUTED_CALL_STATUSES = ["ok", "no_data", "not_found", "tool_error", "exception", "interrupted", "waiting_input"] as const;

/** Llamadas no ejecutadas, sin `denied`, que tiene dos orígenes (5.3). */
export const NOT_EXECUTED_CALL_STATUSES = [
  "args_invalid",
  "refs_unresolved",
  "loop_blocked",
  "user_rejected",
  "tool_rejected",
  "info_missing",
] as const;

export const CALL_STATUSES = [...EXECUTED_CALL_STATUSES, ...NOT_EXECUTED_CALL_STATUSES, "denied"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/** Estados cuyo resultado se verifica: toda llamada ejecutada salvo `interrupted` y `waiting_input`, y nunca `denied` (5.3). */
export const VERIFIABLE_CALL_STATUSES = ["ok", "no_data", "not_found", "tool_error", "exception"] as const;

export const CALL_VERDICTS = ["approved", "rejected"] as const;
export type CallVerdict = (typeof CALL_VERDICTS)[number];

/**
 * Razones de rechazo del verificador (5.3, lista cerrada en 10.1). El contexto guarda solo la clave; el mensaje fijo de
 * cada razón lo arman las vistas. Si se dan ambas, gana `no_usable_data`.
 */
export const VERDICT_REASONS = ["no_usable_data", "not_accomplished"] as const;
export type VerdictReason = (typeof VERDICT_REASONS)[number];

export const ERROR_KINDS = ["service_unavailable"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export const RESULT_ORIGINS = ["model", "fallback"] as const;
export type ResultOrigin = (typeof RESULT_ORIGINS)[number];

// ───────────────────────── JSON plano ─────────────────────────

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ───────────────────────── Secciones con id (5.1) ─────────────────────────

export const SECTION_NAMES = ["plans", "steps", "calls", "errors", "refs"] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

// ───────────────────────── Elementos (5) ─────────────────────────

export interface TaskInfo {
  id: string;
  mode: TaskMode;
  /** Solicitud original. */
  request: string;
  state: TaskState;
  /** Solo en partial, failed y cancelled. */
  stopReason: StopReason | null;
  startedAt: number;
}

export interface Plan {
  id: string;
  at: number;
  trigger: PlanTrigger;
  /** Instrucción del usuario; solo en `user_feedback` (obligatoria ahí). Tope `feedbackMax`. */
  feedback: string | null;
  /** Paso que falló; solo en `step_failure`. */
  stepId: string | null;
}

export interface Step {
  id: string;
  at: number;
  /** Plan que creó el paso; null en reactivo. */
  planId: string | null;
  /** null en reactivo. */
  instruction: string | null;
  /** null en reactivo. */
  route: string | null;
  /** null en reactivo. */
  expected: string | null;
  state: StepState;
  /** true si un replan lo reemplazó (solo deliberativo); false al crearse. */
  superseded: boolean;
}

export interface Call {
  id: string;
  stepId: string;
  at: number;
  route: string;
  tool: string;
  kind: CallKind;
  /** Como los propuso el modelo, refs sin resolver, strings recortados. */
  args: JsonObject | null;
  /** Huella de los argumentos ya resueltos; null si no hubo args resueltos. */
  sig: string | null;
  status: CallStatus;
  /** null al crearse; se actualiza tras la verificación. */
  verdict: CallVerdict | null;
  /** Causa del rechazo; solo con `rejected`. */
  reason: VerdictReason | null;
  /** Tope `summaryMax`; sin modelo. */
  summary: string | null;
  /** Id de una ref; solo si el resumen no contiene el resultado completo. */
  ref: string | null;
}

export interface ErrorEntry {
  id: string;
  stepId: string;
  at: number;
  kind: ErrorKind;
}

export interface Fact {
  /** null = retirado. */
  value: string | null;
  stepId: string;
  at: number;
}

export interface Ref {
  id: string;
  stepId: string;
  at: number;
  label: string;
  /** Tamaño en caracteres. */
  size: number;
  /** Ruta absoluta del archivo con el resultado crudo; el contexto no la interpreta. */
  where: string;
}

export interface ResultEntry {
  text: string;
  origin: ResultOrigin;
}

export interface ContextData {
  v: typeof CONTEXT_VERSION;
  task: TaskInfo;
  plans: Plan[];
  steps: Step[];
  calls: Call[];
  errors: ErrorEntry[];
  facts: { [key: string]: Fact };
  refs: Ref[];
  result: ResultEntry | null;
}

// ───────────────────────── Entradas de `add` (6) ─────────────────────────
// `add` completa id, at, verdict, reason, superseded y el state inicial: quien ejecuta no los escribe.

export interface PlanInput {
  trigger: PlanTrigger;
  feedback: string | null;
  stepId: string | null;
}

export interface StepInput {
  planId: string | null;
  instruction: string | null;
  route: string | null;
  expected: string | null;
}

export interface CallInput {
  stepId: string;
  route: string;
  tool: string;
  kind: CallKind;
  args: JsonObject | null;
  sig: string | null;
  status: CallStatus;
  summary: string | null;
  ref: string | null;
}

export interface ErrorInput {
  stepId: string;
  kind: ErrorKind;
}

export interface RefInput {
  stepId: string;
  label: string;
  size: number;
  where: string;
}

// ───────────────────────── Operaciones (6) ─────────────────────────

export interface StepPatch {
  state?: StepState;
  superseded?: boolean;
}

/** `verdict` y `reason` se actualizan juntos. */
export interface CallPatch {
  verdict: CallVerdict;
  reason: VerdictReason | null;
}

export interface FactInput {
  value: string | null;
  stepId: string;
}

export interface FinishValue {
  state: TerminalTaskState;
  stopReason: StopReason | null;
}

export type FactTarget = `facts.${string}`;

export type Op =
  | { op: "add"; target: "plans"; value: PlanInput }
  | { op: "add"; target: "steps"; value: StepInput }
  | { op: "add"; target: "calls"; value: CallInput }
  | { op: "add"; target: "errors"; value: ErrorInput }
  | { op: "add"; target: "refs"; value: RefInput }
  | { op: "update"; target: string; value: StepPatch | CallPatch }
  | { op: "set"; target: FactTarget; value: FactInput }
  | { op: "set"; target: "result"; value: ResultEntry }
  | { op: "finish"; target: "task"; value: FinishValue };

/** Operación ya normalizada, tal como viaja en el evento `change` (con `id` y `at` asignados). */
export type NormalizedOp =
  | { op: "add"; target: "plans"; value: Plan }
  | { op: "add"; target: "steps"; value: Step }
  | { op: "add"; target: "calls"; value: Call }
  | { op: "add"; target: "errors"; value: ErrorEntry }
  | { op: "add"; target: "refs"; value: Ref }
  | { op: "update"; target: string; value: StepPatch | CallPatch }
  | { op: "set"; target: FactTarget; value: Fact }
  | { op: "set"; target: "result"; value: ResultEntry }
  | { op: "finish"; target: "task"; value: FinishValue };

/** Opaco para el contexto y categórico (sin prosa). */
export type ChangeMeta = Readonly<Record<string, string | number | boolean | null>>;

export interface ChangeEvent {
  /** Contador interno de `apply`; consecutivo. */
  n: number;
  at: number;
  /** Operaciones normalizadas y congeladas (`Object.freeze` profundo): los suscriptores solo leen. */
  ops: readonly Readonly<NormalizedOp>[];
  meta: ChangeMeta | null;
}

export interface ApplyResult {
  n: number;
  /** Ids creados por el lote, en el orden de las operaciones `add`. */
  ids: string[];
}

/**
 * Topes numéricos que `apply` valida (6, regla 7). El contexto no tiene valores propios (principio 5): quien lo crea
 * se los pasa ya resueltos.
 */
export interface ContextLimits {
  /** Largo máximo de `summary`. */
  summaryMax: number;
  /** `ARGS_MAX`: largo máximo de cualquier string de `args`; se calcula desde el catálogo de herramientas. */
  argsStringMax: number;
  /** Largo máximo del valor de un hecho. */
  factValueMax: number;
  /** Largo máximo de `plans.feedback`. */
  feedbackMax: number;
  /** Profundidad máxima de un valor JSON (`args`): niveles de contenedores contando la raíz. */
  jsonMaxDepth: number;
}

export interface ContextOptions extends ContextLimits {
  /** Reloj inyectable: devuelve la marca de tiempo de cada `apply`. */
  now: () => number;
  /** Se invoca si un suscriptor falla; el cambio no se revierte. */
  onListenerError?: (error: unknown) => void;
}

export interface CurrentView {
  /** Paso vigente `running` o, si no hay, el primer vigente `pending`. */
  step: Readonly<Step> | null;
  /** Último elemento de `calls`. */
  lastCall: Readonly<Call> | null;
}

/** Cualquier elemento que devuelve `ctx.get`. */
export type ContextElement = Plan | Step | Call | ErrorEntry | Ref | Fact;

/** Elementos devueltos por `get` y `find`. */
export type ElementOf<S extends SectionName> = S extends "plans"
  ? Plan
  : S extends "steps"
  ? Step
  : S extends "calls"
  ? Call
  : S extends "errors"
  ? ErrorEntry
  : Ref;