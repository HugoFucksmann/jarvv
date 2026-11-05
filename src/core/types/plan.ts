/**
 * JARVIS Core — Pasos de plan, argumentos generados y contratos de entrada y salida de los modelos.
 */

import type { ExecutableRoute } from "./routes.ts";
import type { TimeSpan } from "./audit.ts";
import type { UserEnvironment } from "../environment.ts";
import type { MCPTool } from "./mcp.ts";















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
  environment: UserEnvironment;
  tool: MCPTool;
  cleanedSchema: Record<string, unknown>;
  /** Lecturas anteriores con datos (la más antigua primero): lo que el paso puede necesitar y ya no es la última llamada. */
  dataObs?: Array<{ stepId: string; label: string; obsText: string }>;
  lastObs?: { stepId: string; toolName: string; obsText: string };
  taskInstruction: string;
}

export interface ArgumentsGenerationResult {
  args: Record<string, unknown>;
  rawInput: string;
  rawOutput: string;
  timing: TimeSpan;
  failedAttempts?: FailedAttempt[];
}

/** Intercambio cuya salida no se pudo usar. */
export interface FailedAttempt {
  rawInput: string;
  rawOutput: string;
  error: string;
  timing?: TimeSpan;
}

/** Paso de plan ya validado por qwen.ts: ruta ejecutable y criterio de éxito siempre presentes. */
export interface PlanStep {
  id: string;
  instruction: string;
  route: ExecutableRoute;
  expectedOutcome: string;
}

/**
 * Paso tal como lo escribe el LLM (contrato JSON: schema y parser en qwen.ts, texto en prompts.ts).
 * Solo parsePlanSteps (qwen.ts) lo traduce a PlanStep: goal → instruction, suggested_mcp → route,
 * expected_outcome → expectedOutcome. Renombrar una clave aquí rompe la compilación en ese punto.
 */
export interface PlanStepWire {
  goal: string;
  suggested_mcp: ExecutableRoute;
  expected_outcome: string;
}
