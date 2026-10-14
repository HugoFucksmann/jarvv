/**
 * JARVIS Core Debug & Observability Contracts
 * Tipos para seguimiento integral de iteraciones de modelos (Eos-0.8B y Qwen 3.5 9B)
 */

export type ModelType = "EOS_0_8B" | "QWEN_3_5_9B";

export type ModelStage =
  | "DECISION_ONE"
  | "DECISION_TWO"
  | "STEP_VERIFICATION"
  | "PLAN_GENERATION"
  | "ARGUMENT_GENERATION"
  | "STAGE_VERIFICATION"
  | "REPLAN"
  | "FINAL_RESPONSE";

export interface ModelIterationMetrics {
  latencyMs?: number;
  tokens?: {
    input?: number;
    output?: number;
  };
  confidence?: number;
  signals?: Record<string, unknown>;
  verdict?: string;
  isStepSuccess?: boolean;
}

export interface ModelIteration {
  id: string;
  taskId: string;
  model: ModelType;
  stage: ModelStage;
  stepId?: string;
  stepSeq?: number;
  stepTitle?: string;
  timestamp: number;
  input: Record<string, unknown> | string;
  output: Record<string, unknown> | string;
  rawInput?: string;
  rawOutput?: string;
  metrics?: ModelIterationMetrics;
}

export interface StepIterationGroupData {
  stepId: string;
  stepSeq?: number;
  stepTitle: string;
  route?: string;
  tool?: string;
  state?: string;
  iterations: ModelIteration[];
}
