/**
 * JARVIS Core — Planes y verificación semántica de etapas (modo PLAN).
 */

import type { ExecutableRoute } from "./routes.ts";
import type { TimeSpan } from "./audit.ts";

/** Paso de plan ya validado por qwen.ts: ruta ejecutable y criterio de éxito siempre presentes. */
export interface PlanStep {
  id: string;
  instruction: string;
  route: ExecutableRoute;
  expectedOutcome: string;
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
