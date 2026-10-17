/**
 * JARVIS Core — Architecture & Core Contracts
 * Fuente única de tipos del núcleo.
 */

import type { ModelIteration } from "../types/debug.ts";

// ============================================================
// Estados de tarea y paso
// ============================================================

export type TaskState =
  | "RUNNING"
  | "WAITING_INPUT"
  | "COMPLETED"
  | "FAILED"
  | "PARTIAL"
  | "CANCELLED";

export type WaitingReason = "approval" | "plan_confirmation" | "user_answer";

export type StepState =
  | "PENDING"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "UNVERIFIED"
  | "BLOCKED";

// ============================================================
// Rutas (fuente única)
// ============================================================

/**
 * Rutas que ejecutan herramientas MCP. Todo lo demás (schemas JSON, prompts,
 * criterios de Decision, validación de planes) debe derivarse de esta constante.
 */
export const EXECUTABLE_ROUTES = ["windows", "desktop_commander", "free_search"] as const;
export type ExecutableRoute = (typeof EXECUTABLE_ROUTES)[number];

/** `fin` es una señal de Decision #1 (terminar), nunca una ruta ejecutable. */
export type StepRoute = ExecutableRoute | "fin";

export function isExecutableRoute(route: unknown): route is ExecutableRoute {
  return typeof route === "string" && (EXECUTABLE_ROUTES as readonly string[]).includes(route);
}

// ============================================================
// Pasos, llamadas y planes
// ============================================================

export interface StepCall {
  id: string;
  mcp: string;
  tool: string;
  args?: Record<string, unknown>;
  evidence?: Evidence;
  verification?: VerificationState;
  outcome?: ExecutionOutcome;
  error?: string;
  timestamp?: number;
  rawInput?: string;
  rawOutput?: string;
}

export interface Step {
  id: string;
  route: ExecutableRoute;
  instruction: string;
  mcp?: string;
  tool?: string;
  args?: Record<string, unknown>;
  state: StepState;
  evidence?: Evidence;
  verification?: VerificationState;
  outcome?: ExecutionOutcome;
  error?: string;
  calls?: StepCall[];
  rev?: number;
  superseded?: boolean;
  expectedOutcome?: string;
  handoff?: StepHandoff;
  rawInput?: string;
  rawOutput?: string;
  candidate_tools?: string[];
  dependencies?: string[];
  /** Preguntas al usuario ya formuladas para este paso (tope: MAX_USER_QUESTIONS_PER_STEP). */
  questionsAsked?: number;
}

export interface StepHandoff {
  fromStepId: string;
  tool: string;
  finding: string;
  primaryFact?: { key: string; value: string };
  refKey?: string;
  factsDelta?: Record<string, string>;
  timestamp: number;
}

/** Paso de plan ya validado por qwen.ts: ruta ejecutable y criterio de éxito siempre presentes. */
export interface PlanStep {
  id: string;
  instruction: string;
  route: ExecutableRoute;
  expectedOutcome: string;
}

export interface Plan {
  objective?: string;
  steps: PlanStep[];
  rawInput?: string;
  rawOutput?: string;
}

// ============================================================
// Verificación semántica de etapas (modo PLAN)
// ============================================================

export type StageVerificationStatus =
  | "completed"
  | "recoverable_deviation"
  | "insufficient_info"
  | "unrecoverable_blocked";

export interface StageVerificationResult {
  status: StageVerificationStatus;
  reason: string;
  questionForUser?: string;
  rawInput?: string;
  rawOutput?: string;
}

export interface StageVerificationPromptData {
  goal: string;
  stepInstruction: string;
  expectedOutcome: string;
  evidenceSummary?: string;
  compactObs?: string;
  facts?: Record<string, string>;
  logLines?: string[];
  /** Cambios ya aplicados al entorno: la verificación no debe tratarlos como pendientes. */
  effects?: string[];
  failLines?: string[];
}

// ============================================================
// Memoria y tarea
// ============================================================

export interface Scratchpad {
  search_results?: unknown[];
  selected_result?: unknown;
  url?: string;
  path?: string;
  process_id?: string;
  text?: string;
  window_handle?: string;
  element_id?: string;
  /** Total de resultados de la última búsqueda; `search_results` solo conserva los primeros MAX_SCRATCHPAD_RESULTS. */
  search_results_total?: number;
}

export interface TaskMemory {
  log: string[];
  facts: Record<string, string>;
  fail: string[];
  effects?: string[];
  /**
   * @deprecated Ya no se escribe: la traza cruda vive solo en `Task.modelIterations`. Se mantiene el campo para leer
   * tareas persistidas antes de este cambio (la migración de carga lo elimina cuando es redundante) y para que la
   * vista del cliente lo derive de las iteraciones (deriveTaskView).
   */
  rawInteractions?: Array<{
    timestamp: number;
    model: string;
    stage: string;
    rawInput: string;
    rawOutput: string;
  }>;
}

/** Pregunta abierta al usuario (WAITING_INPUT/user_answer). Se persiste para sobrevivir a recargas y reinicios. */
export interface PendingQuestion {
  stepId: string;
  question: string;
  /** Motivo por el que la verificación semántica no pudo concluir. */
  reason: string;
  askedAt: number;
}

export interface UserAnswer {
  stepId?: string;
  question?: string;
  answer: string;
  answeredAt: number;
}

export interface Task {
  id: string;
  message: string;
  mode: "NORMAL" | "PLAN";
  steps: Step[];
  currentStep: number;
  scratchpad: Scratchpad;
  state: TaskState;
  waitingReason?: WaitingReason;
  pendingQuestion?: PendingQuestion;
  userAnswers?: UserAnswer[];
  finalResponse?: string;
  /**
   * `false` solo mientras el plan espera confirmación (WAITING_INPUT/plan_confirmation). Al terminar la tarea
   * (cancelada, rechazada, fallida…) el núcleo lo deja sin definir: un `false` residual hace que la UI siga
   * mostrando la revisión de un plan que ya no admite ninguna acción.
   */
  planConfirmed?: boolean;
  memory?: TaskMemory;
  replans?: number;
  escalations?: number;
  stepSeq?: number;
  modelIterations?: ModelIteration[];
  rawPlanInput?: string;
  rawPlanOutput?: string;
  rawFinalInput?: string;
  rawFinalOutput?: string;
}

export interface Evidence {
  ok: boolean;
  summary?: string;
  flags?: string[];
  ref?: string;
  obs?: string;
}

export type VerificationState =
  | "VERIFIED"
  | "NOT_REQUIRED"
  | "UNVERIFIED";

export interface ExecutionOutcome {
  success?: boolean;
  isError?: boolean;
  actionDispatched?: boolean;
  outcomeVerified?: boolean;
}

// ============================================================
// Políticas y Guard
// ============================================================

export type Capability =
  | "READ"
  | "PROCESS_CONTROL"
  | "FILE_READ"
  | "FILE_WRITE"
  | "COMMAND_EXECUTION"
  | "DOWNLOAD"
  | "CONFIGURATION";

export type ToolKind = "READ" | "no-READ";

export type GuardResult = "ALLOW" | "DENY" | "APPROVAL";

export interface GuardDecision {
  decision: GuardResult;
  reason?: string;
  capability: Capability;
}

export interface ToolPolicy {
  capability: Capability;
  requiresApproval?: boolean;
  kind?: ToolKind;
  mutates?: boolean;
  emptyIsError?: boolean;
  /** Exenta del anti-loop (p. ej. sondeos repetidos de una misma salida). */
  loopExempt?: boolean;
}

// ============================================================
// Resultado de ejecución de pasos
// ============================================================

export type StepExecutionStatus = "ok" | "logical_error" | "unverified" | "blocked_loop";

export interface StepExecutionSignals {
  exit_code?: number;
  exception?: boolean;
  timeout?: boolean;
  not_found?: boolean;
  denied?: boolean;
  empty_output?: boolean;
}

export interface StepExecutionResult {
  status: StepExecutionStatus;
  step: Step;
  call?: StepCall;
  error?: string;
  signals?: StepExecutionSignals;
}

export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
] as const;

export function isTerminalState(state: TaskState): boolean {
  return (TERMINAL_TASK_STATES as readonly string[]).includes(state);
}

// ============================================================
// Límites globales del núcleo
// ============================================================

export const MAX_STEPS = 15;
export const MAX_ESCALATIONS = 2;
export const MAX_REPLAN = 2;
/** Tareas retenidas en memoria y en disco. Las terminales más antiguas se expulsan (junto con sus refs). */
export const MAX_RETAINED_TASKS = 20;
/** Resultados de búsqueda conservados en `scratchpad.search_results`. */
export const MAX_SCRATCHPAD_RESULTS = 10;
/** Máximo de preguntas al usuario por paso antes de tratar la falta de información como desviación recuperable. */
export const MAX_USER_QUESTIONS_PER_STEP = 2;
export const PROGRESSIVE_MEMORY_TIERS = [2, 5, 10] as const;
export type ProgressiveMemoryLimit = (typeof PROGRESSIVE_MEMORY_TIERS)[number];

/** Política unificada de reintentos hacia Qwen y Decision. Reintentos ante fallo de red o HTTP 503 (nunca ante timeout ni abort). */
export const LLM_TRANSPORT_RETRIES = 1;
export const LLM_TRANSPORT_BACKOFF_MS = 1000;
/** Reintentos ante salida inválida o truncada del modelo. */
export const LLM_INVALID_OUTPUT_RETRIES = 1;

// ============================================================
// Decision 2.0
// ============================================================

export type DecisionQuestionType = "choice" | "noul";

export interface DecisionQuestionChoice {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface DecisionQuestionNoul {
  type: "noul";
  instructions: string;
}

export type DecisionQuestion =
  | DecisionQuestionChoice
  | DecisionQuestionNoul;

/** Respuesta de una pregunta `choice`: opción elegida y distribución de probabilidades. */
export interface DecisionAnswerChoice {
  choice: string;
  probabilities: Record<string, number>;
}

/** Respuesta de una pregunta `noul`: probabilidad de la afirmativa, en [0, 1]. */
export interface DecisionAnswerNoul {
  noul: number;
}

export type DecisionAnswer =
  | DecisionAnswerChoice
  | DecisionAnswerNoul;

export interface DecisionResponse {
  answers: Record<string, DecisionAnswer>;
  rawInput: string;
  rawOutput: string;
}

// ============================================================
// Contratos MCP
// ============================================================

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface MCPContentItem {
  type: string;
  text?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface MCPCallResult {
  content: MCPContentItem[];
  isError?: boolean;
  success?: boolean;
  actionDispatched?: boolean;
  outcomeVerified?: boolean;
  search_incomplete?: boolean;
  truncated?: boolean;
  retrieved_at?: string;
  cache_age_seconds?: number;
  trimmed?: Record<string, unknown>;
  benched_engines?: string[];
  [key: string]: unknown;
}

// ============================================================
// Aprobaciones y eventos
// ============================================================

export interface PendingApproval {
  id: string;
  stepId: string;
  mcp: string;
  tool: string;
  capability: Capability;
  args: Record<string, unknown>;
  reason: string;
  onApprove: () => void;
  onDeny: (reason?: string) => void;
}

export type CoreEventType =
  | "TASK_CREATED"
  | "DECISION_ONE"
  | "DISCOVERY_REFRESH"
  | "DECISION_TWO"
  | "ARGUMENTS_GENERATED"
  | "GUARD_EVALUATION"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_RESOLVED"
  | "MCP_DISPATCHED"
  | "MCP_RESULT"
  | "RESULT_PROCESSED"
  | "STEP_STATE_CHANGED"
  | "STEP_COMPLETED"
  | "FINAL_RESPONSE"
  | "TASK_STATE_CHANGED"
  | "PLAN_GENERATED"
  | "PLAN_REJECTED"
  | "PLAN_MODIFIED"
  | "STAGE_VERIFIED";

export interface CoreEvent {
  type: CoreEventType;
  timestamp: number;
  taskId: string;
  stepId?: string;
  data: Record<string, unknown>;
}