import type { ExecutableRoute } from "./routes.ts";
import type { TimeSpan } from "./audit.ts";
import type { Step } from "./task.ts";
import type { StageVerificationResult } from "./plan.ts";

/**
 * Resultado de una llamada que llegó a ejecutarse. Se calcula una sola vez (classifyCall en callExecutor.ts) y de él
 * se derivan el token del LOG, la línea de FAIL, evidence.ok, outcome.success y los efectos.
 */
export type ExecutedCallStatus = "ok" | "unverified" | "rejected" | "tool_error" | "not_found" | "no_data";
/** Llamada que no produjo un resultado utilizable (falló antes de ejecutarse o por una excepción). */
export type CallFailureStatus = "args_invalid" | "refs_unresolved" | "loop_blocked" | "denied" | "user_rejected" | "exception";
export type CallStatus = ExecutedCallStatus | CallFailureStatus;

/** Acción ya ejecutada, tal como la ven Decision #1 y #2 para marcar rutas y herramientas cuyo último intento falló. */
export interface Attempt {
  /** Destino bajo el que se ejecutó la herramienta: es el vocabulario de Decision #1. */
  route: ExecutableRoute;
  /** Servidor MCP real: acota el estado "falló" de Decision #2. */
  mcp?: string;
  tool: string;
  ok: boolean;
  note?: string;
}

export interface StepCall {
  id: string;
  mcp: string;
  tool: string;
  args?: Record<string, unknown>;
  status?: CallStatus;
  evidence?: Evidence;
  verification?: VerificationState;
  outcome?: ExecutionOutcome;
  error?: string;
  /** Momento en que se registró la llamada (tras la verificación). */
  timestamp?: number;
  /** Ejecución de la herramienta en el servidor MCP: inicio y duración. No incluye la verificación posterior. */
  execution?: TimeSpan;
  rawInput?: string;
  rawOutput?: string;
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
}

export type StepExecutionStatus = "ok" | "logical_error" | "unverified" | "loop_blocked";

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
  /** Solo modo PLAN: veredicto de Qwen cuando Eos no aprobó el paso (segundo juez). */
  semantic?: StageVerificationResult;
}