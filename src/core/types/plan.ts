/**
 * JARVIS Core — Planes y verificación semántica de etapas (modo PLAN).
 */

import type { ExecutableRoute } from "./routes.ts";
import type { TimeSpan } from "./audit.ts";
import type { UserEnvironment } from "../environment.ts";
import type { MCPTool } from "./mcp.ts";

/** Paso de plan ya validado por qwen.ts: ruta ejecutable y criterio de éxito siempre presentes. */
export interface PlanStep {
  id: string;
  instruction: string;
  route: ExecutableRoute;
  expectedOutcome: string;
}

/**
 * Paso tal como lo escribe Qwen (contrato JSON: schema y parser en qwen.ts, texto en prompts.ts).
 * Solo parsePlanSteps (qwen.ts) lo traduce a PlanStep: goal → instruction, suggested_mcp → route,
 * expected_outcome → expectedOutcome. Renombrar una clave aquí rompe la compilación en ese punto.
 */
export interface PlanStepWire {
  goal: string;
  suggested_mcp: ExecutableRoute;
  expected_outcome: string;
}

export interface PlanRevision {
  feedback: string;
  existingPlanSummary: string;
}

export interface Plan {
  objective?: string;
  steps: PlanStep[];
  rawInput?: string;
  rawOutput?: string;
  timing?: TimeSpan;
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
  timing?: TimeSpan;
}

export interface StageVerificationPromptData {
  goal: string;
  stepInstruction: string;
  expectedOutcome: string;
  /** Herramienta y argumentos que se ejecutaron (p. ej. el script completo): sin esto el verificador solo ve lo que el proceso imprimió. */
  executedAction?: string;
  evidenceSummary?: string;
  compactObs?: string;
  facts?: Record<string, string>;
  logLines?: string[];
  /** Cambios ya aplicados al entorno: la verificación no debe tratarlos como pendientes. */
  effects?: string[];
  failLines?: string[];
}

// ============================================================
// Contrato con el cliente LLM (entradas y salidas de ILLMClient)
// ============================================================

/** Intercambio cuya salida no se pudo usar. */
export interface FailedAttempt {
  rawInput: string;
  rawOutput: string;
  error: string;
  timing?: TimeSpan;
}

export interface ArgumentPromptData {
  goal: string;
  chatContext?: string;
  logLines?: string[];
  planLines?: string[];
  failLines?: string[];
  facts?: Record<string, string>;
  effects?: string[];
  /** Referencias disponibles (`ref:rX origen (tamaño)`), las más recientes. */
  refs?: string[];
  /** Rutas reales de esta PC (carpeta personal, escritorio, documentos, descargas). */
  environment: UserEnvironment;
  tool: MCPTool;
  cleanedSchema: Record<string, unknown>;
  /** Lecturas anteriores con datos (la más antigua primero): lo que el paso puede necesitar y ya no es la última llamada. */
  dataObs?: Array<{ stepId: string; label: string; obsText: string }>;
  lastObs?: { stepId: string; toolName: string; obsText: string };
  taskInstruction: string;
}

export interface FinalResponsePromptData {
  goal: string;
  logLines: string[];
  facts: Record<string, string>;
  failLines: string[];
  effects?: string[];
  evidenceSummaries: string[];
  abortReason?: string;
}

export interface ReplanPromptData {
  goal: string;
  completedStepsSummary: string[];
  facts: Record<string, string>;
  failLines: string[];
  /** Cambios ya aplicados al entorno (incluidos los de pasos cuya verificación falló). */
  effects?: string[];
  logLines?: string[];
  failedStepGoal: string;
  failedStepResult: string;
  remainingPlanGoals: string[];
  /** Numeración del primer paso nuevo; la asigna el código, el prompt no la menciona. */
  nextStepNumber: number;
}

export interface ArgumentsGenerationResult {
  args: Record<string, unknown>;
  rawInput: string;
  rawOutput: string;
  timing: TimeSpan;
  failedAttempts?: FailedAttempt[];
}

export interface FinalResponseResult {
  response: string;
  rawInput: string;
  rawOutput: string;
  timing: TimeSpan;
}

export interface ReplanResult {
  action?: "abort" | "continue";
  reason?: string;
  plan?: Plan;
  rawInput?: string;
  rawOutput?: string;
  timing?: TimeSpan;
}