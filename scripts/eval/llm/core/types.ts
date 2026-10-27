import type {
  ArgumentPromptData,
  FinalResponsePromptData,
  ReplanPromptData,
} from "../../../../src/core/reasoner/prompts.ts";

export type LlmEvalStage = "plan" | "replan" | "arguments" | "final_response";
export type QwenEvalStage = LlmEvalStage;

/** Datos con los que producción arma el prompt de cada etapa (los mismos constructores de prompts.ts). */
export type LlmPromptInput =
  | {
    stage: "plan";
    goal: string;
    chatContext?: string;
    compactCatalog?: string;
    modificationFeedback?: string;
    existingPlanSummary?: string;
  }
  | { stage: "replan"; data: ReplanPromptData }
  | { stage: "arguments"; data: ArgumentPromptData }
  | { stage: "final_response"; data: FinalResponsePromptData };
export type QwenPromptInput = LlmPromptInput;

export interface PlanEvaluationExpectation {
  minSteps?: number;
  maxSteps?: number;
  allowedRoutes?: string[];
  requiredKeywordsInGoal?: string[];
  forbiddenKeywordsInGoal?: string[];
  allowEmpty?: boolean;
  /** Ruta del primer paso. */
  firstRoute?: string;
  /** Rutas que deben aparecer al menos una vez. */
  requiredRoutes?: string[];
}

export interface ReplanEvaluationExpectation {
  expectedAction?: "continue" | "abort";
  minSteps?: number;
  maxSteps?: number;
  allowedRoutes?: string[];
  mustNotRepeatEffects?: boolean;
  effects?: string[];
  mustNotRepeatCompleted?: boolean;
  completedSteps?: string[];
}

export interface JsonStringFieldCheck {
  /** Campo string cuyo valor es JSON. */
  field: string;
  /** "array2d": [[...]]; "sheets": { "Hoja": [[...]] }. */
  shape?: "array2d" | "sheets";
  /** Textos que deben aparecer en el contenido. */
  includes?: string[];
}

export interface ArgumentsEvaluationExpectation {
  tool?: string;
  requiredFields?: string[];
  exactFieldValues?: Record<string, unknown>;
  allowedRefTokens?: string[];
  forbiddenHardcodedValues?: string[];
  noInventedFields?: boolean;
  jsonStringFields?: JsonStringFieldCheck[];
}

export interface FinalResponseEvaluationExpectation {
  mustContainFacts?: string[];
  mustMentionEffects?: string[];
  mustMentionAbortReason?: boolean;
  forbiddenHallucinations?: string[];
  minChars?: number;
}

export interface LlmTestCase {
  id: string;
  stage: LlmEvalStage;
  category: string;
  description: string;
  input: {
    system?: string;
    user?: string;
    prompt?: LlmPromptInput;
    schema?: Record<string, unknown>;
    toolName?: string;
    thinking?: boolean;
  };
  expect: {
    plan?: PlanEvaluationExpectation;
    replan?: ReplanEvaluationExpectation;
    arguments?: ArgumentsEvaluationExpectation;
    final_response?: FinalResponseEvaluationExpectation;
  };
  notes?: string;
}
export type QwenTestCase = LlmTestCase;

export interface LlmRunStepMetric {
  ok: boolean;
  error?: string;
  details?: Record<string, unknown>;
}
export type QwenRunStepMetric = LlmRunStepMetric;

export interface LlmRunRecord {
  case_id: string;
  stage: LlmEvalStage;
  category: string;
  status: "pass" | "fail" | "error";
  thinking: boolean;
  prompt_source: "prod" | "raw";
  /** Hash de la definición del caso (input + expect): detecta cambios de dataset entre corridas. */
  case_hash: string;
  /** Hash del prompt renderizado: identifica la versión del prompt realmente enviada. */
  system_hash?: string;
  user_hash?: string;
  latency_ms: number;
  prompt_tokens_est: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  max_tokens?: number;
  finish_reason?: string;
  reasoning_chars?: number;
  raw_output?: string;
  parsed_output?: unknown;
  /** Checks pass/fail (solo booleanos). */
  metrics: Record<string, boolean>;
  /** Valores medidos que no son pass/fail (conteos, acción elegida, largo). */
  measurements: Record<string, number | string>;
  errors: string[];
  warnings: string[];
}
export type QwenRunRecord = LlmRunRecord;

export interface LlmStageSummary {
  total: number;
  passed: number;
  pass_rate: number;
  avg_latency_ms: number;
  metrics_breakdown: Record<string, { pass: number; total: number }>;
}
export type QwenStageSummary = LlmStageSummary;

export interface LlmThinkingSummary extends LlmStageSummary {
  avg_completion_tokens: number;
}
export type QwenThinkingSummary = LlmThinkingSummary;

export interface LlmRunSettings {
  model: string;
  url: string;
  num_ctx: number;
  timeout_ms: number;
  thinking_timeout_ms: number;
  max_tokens: Record<LlmEvalStage, number>;
  final_thinking: "both" | "on" | "off" | "config";
  prompts?: string;
}
export type QwenRunSettings = LlmRunSettings;

export interface LlmScoresSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  pass_rate: number;
  avg_latency_ms: number;
  finish_reasons: Record<string, number>;
  settings: LlmRunSettings;
  by_stage: Partial<Record<LlmEvalStage, LlmStageSummary>>;
  /** Solo etapas que corrieron con y sin thinking. */
  thinking_comparison: Partial<Record<LlmEvalStage, { off: LlmThinkingSummary; on: LlmThinkingSummary }>>;
}
export type QwenScoresSummary = LlmScoresSummary;