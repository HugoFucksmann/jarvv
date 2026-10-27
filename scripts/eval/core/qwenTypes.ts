import type { PlanStep } from "../../../src/core/types.ts";

export type QwenEvalStage = "plan" | "replan" | "arguments" | "final_response";

export interface PlanEvaluationExpectation {
  minSteps?: number;
  maxSteps?: number;
  allowedRoutes?: string[];
  requiredKeywordsInGoal?: string[];
  forbiddenKeywordsInGoal?: string[];
  allowEmpty?: boolean;
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

export interface ArgumentsEvaluationExpectation {
  tool: string;
  requiredFields?: string[];
  exactFieldValues?: Record<string, unknown>;
  allowedRefTokens?: string[];
  forbiddenHardcodedValues?: string[];
  noInventedFields?: boolean;
}

export interface FinalResponseEvaluationExpectation {
  mustContainFacts?: string[];
  mustMentionEffects?: string[];
  mustMentionAbortReason?: boolean;
  forbiddenHallucinations?: string[];
  minChars?: number;
}

export interface QwenTestCase {
  id: string;
  stage: QwenEvalStage;
  category: string;
  description: string;
  input: {
    system?: string;
    user: string;
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

export interface QwenRunStepMetric {
  ok: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface QwenRunRecord {
  case_id: string;
  stage: QwenEvalStage;
  category: string;
  status: "pass" | "fail" | "error";
  latency_ms: number;
  prompt_tokens_est: number;
  completion_tokens?: number;
  raw_output?: string;
  parsed_output?: unknown;
  metrics: Record<string, boolean | number | string | undefined>;
  errors: string[];
}

export interface QwenScoresSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  pass_rate: number;
  avg_latency_ms: number;
  by_stage: Record<
    QwenEvalStage,
    {
      total: number;
      passed: number;
      pass_rate: number;
      avg_latency_ms: number;
      metrics_breakdown: Record<string, { pass: number; total: number }>;
    }
  >;
}
