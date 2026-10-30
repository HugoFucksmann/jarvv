import type { ExecutableRoute } from "./routes.ts";
import type { ModelIteration } from "./audit.ts";
import type { StepCall, Evidence, VerificationState, ExecutionOutcome } from "./execution.ts";

export type TaskState =
  | "RUNNING"
  | "WAITING_INPUT"
  | "COMPLETED"
  | "FAILED"
  | "PARTIAL"
  | "CANCELLED";

/** NORMAL = bucle reactivo (FAST); PLAN = plan confirmado por el usuario antes de ejecutarse. */
export type TaskMode = "NORMAL" | "PLAN";

export type WaitingReason = "approval" | "plan_confirmation" | "user_answer";

export type StepState =
  | "PENDING"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "UNVERIFIED"
  | "BLOCKED";

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
  /** Preguntas al usuario ya formuladas para este paso (tope: MAX_USER_QUESTIONS_PER_STEP). */
  questionsAsked?: number;
}

export interface StepHandoff {
  fromStepId: string;
  tool: string;
  finding: string;
  primaryFact?: { key: string; value: string };
  refKey?: string;
  timestamp: number;
}

export interface Scratchpad {
  search_results?: unknown[];
  url?: string;
  path?: string;
  process_id?: string;
  /** Total de resultados de la última búsqueda; `search_results` solo conserva los primeros MAX_SCRATCHPAD_RESULTS. */
  search_results_total?: number;
}

export interface TaskMemory {
  log: string[];
  facts: Record<string, string>;
  fail: string[];
}

/** Pregunta abierta al usuario (WAITING_INPUT/user_answer). Vive en la tarea para sobrevivir a recargas de la UI. */
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
  mode: TaskMode;
  steps: Step[];
  currentStep: number;
  scratchpad: Scratchpad;
  state: TaskState;
  waitingReason?: WaitingReason;
  pendingQuestion?: PendingQuestion;
  userAnswers?: UserAnswer[];
  finalResponse?: string;
  /** Origen de la respuesta final: redactada por el modelo o plantilla determinista de respaldo. */
  finalResponseSource?: "model" | "fallback";
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

export const TERMINAL_TASK_STATES: readonly TaskState[] = ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"];

export function isTerminalState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}