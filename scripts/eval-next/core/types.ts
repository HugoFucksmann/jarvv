/**
 * scripts/eval-next/core/types.ts
 *
 * Contrato unificado de tipos para la arquitectura de evaluación de JARVIS.
 * Cubre las 8 etapas (4 de Decisión + 4 Generativas).
 */

import type { MCPTool } from "../../../src/core/types.ts";
import type { ExecutableRoute } from "../../../src/core/types/routes.ts";
export type { ModelClient } from "./clients/types.ts";
import type {
  RouteDecisionInput,
  ToolDecisionInput,
  ReviewDecisionInput,
  VerifyDecisionInput,
} from "../../../src/core/engine/deps.ts";
import type { PlanView, ArgsView, FinalView, AskView } from "../../../src/core/ctx/index.ts";

// StageName se mantiene aquí como unión manual para evitar ciclos de importación.
// stages/index.ts valida en tiempo de compilación que el registro cubra exactamente estos valores.
export type DecisionStageName =
  | "route"
  | "tool_choice"
  | "args_review"
  | "result_verification";

export type GenerativeStageName =
  | "plan"
  | "arguments"
  | "final"
  | "question";

export type StageName = DecisionStageName | GenerativeStageName;

// ============================================================================
// Model Requests & Responses
// ============================================================================

export type ClientType = "generative" | "decision";

export interface GenerativeModelRequest {
  type: "generative";
  system: string;
  user: string;
  json: boolean;
  schema?: Record<string, unknown>;
  maxTokens?: number;
  thinking?: boolean;
}

export interface DecisionModelRequest {
  type: "decision";
  backend: "d3" | "eos";
  state: string;
  questions: Record<string, unknown>;
}

export type ModelRequest = GenerativeModelRequest | DecisionModelRequest;

export interface ModelResponse {
  rawOutput: string;
  durationMs: number;
  tokens?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  finishReason?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Stage Parse Results & Graders
// ============================================================================

export interface ParseSuccess<T> {
  ok: true;
  value: T;
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export interface GraderContext {
  rawOutput: string;
  finishReason?: string;
  durationMs: number;
  modelResponse: ModelResponse;
}

export interface GraderCollector {
  check(key: string, ok: boolean, errorMessage: string): boolean;
  soft(key: string, ok: boolean, warningMessage: string): boolean;
  measure(key: string, value: number | string): void;
}

export interface Grader<TOutput, TExpect> {
  name: string;
  grade(
    output: TOutput | undefined,
    expect: TExpect,
    ctx: GraderContext,
    collector: GraderCollector
  ): void;
}

// ============================================================================
// Prompt Variants
// ============================================================================

export interface PromptVariant {
  name: string;
  systemOverride?: string;
  userPrefix?: string;
  customOptions?: Record<string, unknown>;
}

// ============================================================================
// Inputs & Expects per Stage
// ============================================================================

// 1. ROUTE
export type RouteInput = RouteDecisionInput;
export interface RouteExpect {
  expectedAction: "route" | "fin" | "ask_user";
  expectedRoute?: ExecutableRoute;
  minProbability?: number;
}
export interface RouteOutput {
  action: string;
  route?: string;
  probabilities?: Record<string, number>;
}

// 2. TOOL_CHOICE
export type ToolChoiceInput = ToolDecisionInput;
export interface ToolChoiceExpect {
  expectedTool?: string;
  expectedAction?: "tool" | "ask_user";
  minProbability?: number;
}
export interface ToolChoiceOutput {
  selected: string;
  probabilities?: Record<string, number>;
}

// 3. ARGS_REVIEW
export type ArgsReviewInput = ReviewDecisionInput;
export interface ArgsReviewExpect {
  expectedReview: "approved" | "args_invalid" | "tool_rejected" | "info_missing";
  minProbability?: number;
}
export interface ArgsReviewOutput {
  review: string;
  probabilities?: Record<string, number>;
}

// 4. RESULT_VERIFICATION
export type ResultVerificationInput = VerifyDecisionInput;
export interface ResultVerificationExpect {
  expectedOk: boolean;
  expectedCumple: boolean;
  minOkProb?: number;
  minCumpleProb?: number;
}
export interface ResultVerificationOutput {
  ok: boolean;
  cumple: boolean;
  okProbability: number;
  cumpleProbability: number;
}

// 5. PLAN
export type PlanInput =
  | { mode?: "view"; view: PlanView; maxSteps: number; catalog?: string }
  | { mode: "raw"; text: string; maxSteps: number; catalog?: string };

export interface PlanStepOutput {
  goal: string;
  suggested_mcp: string;
  expected_outcome: string;
}

export interface PlanOutput {
  steps: PlanStepOutput[];
}

export interface PlanExpect {
  minSteps?: number;
  maxSteps?: number;
  allowedRoutes?: string[];
  requiredRoutes?: string[];
  firstRoute?: string;
  requiredKeywordsInGoal?: string[];
  forbiddenKeywordsInGoal?: string[];
  allowEmpty?: boolean;
  /** Replan por fallo: no repetir metas ya falladas */
  forbiddenRepeatedGoals?: string[];
  /** Replan por fallo: no repetir efectos o mutaciones ya ejecutadas */
  forbiddenExecutedEffects?: string[];
  /** Replan por feedback: incorporar instrucciones o términos clave del usuario */
  mustReflectFeedback?: string[];
  /** Si true, espera explícitamente steps: [] (ej. cuando no hay tools) */
  expectEmpty?: boolean;
}

// 6. ARGUMENTS
export type ArgumentsInput =
  | { mode?: "view"; view: ArgsView; tool: MCPTool; environment?: Record<string, string> }
  | { mode: "raw"; text: string; tool: MCPTool; environment?: Record<string, string> };

export interface ArgumentsOutput {
  args: Record<string, unknown>;
}

export interface ArgumentsExpect {
  requiredFields?: string[];
  exactFieldValues?: Record<string, unknown>;
  allowedRefTokens?: string[];
  forbiddenHardcodedValues?: string[];
  noInventedFields?: boolean;
}

// 7. FINAL
export type FinalInput =
  | { mode?: "view"; view: FinalView }
  | { mode: "raw"; text: string };

export interface FinalOutput {
  response: string;
}

export interface FinalExpect {
  mustContainFacts?: string[];
  mustMentionEffects?: string[];
  forbiddenHallucinations?: string[];
}

// 8. QUESTION
export type QuestionInput =
  | { mode?: "view"; view: AskView }
  | { mode: "raw"; text: string };

export interface QuestionOutput {
  question: string;
}

export interface QuestionExpect {
  maxChars?: number;
  mustContainKeywords?: string[];
  forbiddenKeywords?: string[];
  singleQuestionOnly?: boolean;
}

// ============================================================================
// Eval Cases (Discriminative Union by stage)
// ============================================================================

export interface BaseEvalCase {
  id: string;
  description?: string;
  tags?: string[];
  isRaw?: boolean;
}

export interface RouteEvalCase extends BaseEvalCase {
  stage: "route";
  input: RouteInput;
  expect: RouteExpect;
}

export interface ToolChoiceEvalCase extends BaseEvalCase {
  stage: "tool_choice";
  input: ToolChoiceInput;
  expect: ToolChoiceExpect;
}

export interface ArgsReviewEvalCase extends BaseEvalCase {
  stage: "args_review";
  input: ArgsReviewInput;
  expect: ArgsReviewExpect;
}

export interface ResultVerificationEvalCase extends BaseEvalCase {
  stage: "result_verification";
  input: ResultVerificationInput;
  expect: ResultVerificationExpect;
}

export interface PlanEvalCase extends BaseEvalCase {
  stage: "plan";
  input: PlanInput;
  expect: PlanExpect;
}

export interface ArgumentsEvalCase extends BaseEvalCase {
  stage: "arguments";
  input: ArgumentsInput;
  expect: ArgumentsExpect;
}

export interface FinalEvalCase extends BaseEvalCase {
  stage: "final";
  input: FinalInput;
  expect: FinalExpect;
}

export interface QuestionEvalCase extends BaseEvalCase {
  stage: "question";
  input: QuestionInput;
  expect: QuestionExpect;
}

export type EvalCase =
  | RouteEvalCase
  | ToolChoiceEvalCase
  | ArgsReviewEvalCase
  | ResultVerificationEvalCase
  | PlanEvalCase
  | ArgumentsEvalCase
  | FinalEvalCase
  | QuestionEvalCase;

// ============================================================================
// Stage Definition Contract
// ============================================================================

export interface StageDefinition<TInput = unknown, TOutput = unknown, TExpect = unknown> {
  name: StageName;
  defaultClient: ClientType;
  defaultThinking: boolean;
  maxTokensKey?: "plan" | "replan" | "arguments" | "final" | "verify";
  build(input: TInput, variant: PromptVariant): ModelRequest;
  parse(raw: string, input: TInput): ParseResult<TOutput>;
  graders: Grader<TOutput, TExpect>[];
}

// ============================================================================
// Run Records and Result Formats
// ============================================================================

/** Versión del esquema de salida. Incrementar al cambiar campos incompatibles. */
export const SCHEMA_VERSION = 1;

export interface RunRecord {
  schemaVersion: number;
  caseId: string;
  stage: StageName;
  iteration: number;
  variant: string;
  model: string;
  passed: boolean;
  isRaw?: boolean;
  errors: string[];
  warnings: string[];
  metrics: Record<string, boolean>;
  measurements: Record<string, number | string>;
  // Campos de primer nivel para decisiones y análisis
  predictedLabel?: string | null;
  expectedLabel?: string | null;
  probabilities?: Record<string, number> | null;
  rawScore?: number | null;
  requestParams?: {
    temperature?: number;
    thinking?: boolean;
    maxTokens?: number;
    timeoutMs?: number;
    seed?: number;
  };
  /** Hash sha256 (16 hex chars) de la request serializada enviada al modelo. */
  requestHash: string;
  rawInput: unknown;
  rawOutput: string;
  parsedOutput?: unknown;
  durationMs: number;
  tokens?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  finishReason?: string;
  timestamp: string;
}

export interface CaseScoreSummary {
  caseId: string;
  stage: StageName;
  runsCount: number;
  passCount: number;
  passRate: number;
  /** Varianza muestral de pases binarios entre repeticiones. null cuando runsCount=1. */
  variance: number | null;
  /** true si el caso pasó en TODAS las repeticiones (pass^k). */
  passAll: boolean;
  avgDurationMs: number;
}

export interface StageScoreSummary {
  stage: StageName;
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  /** Fracción de casos con passAll=true (consistencia entre repeticiones). */
  passAllRate: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  accuracy?: number;
  confusionMatrix?: Record<string, Record<string, number>>;
  /** Runs de casos marcados como raw (excluidos del passRate canónico). */
  rawTotalRuns: number;
  rawPassedRuns: number;
  rawPassRate: number;
  cases: CaseScoreSummary[];
}

export interface GlobalScoreSummary {
  schemaVersion: number;
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  /** Fracción de casos con passAll=true (consistencia global). */
  passAllRate: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  /** Métricas de casos raw (excluidos del passRate canónico). */
  rawTotalRuns: number;
  rawPassedRuns: number;
  rawPassRate: number;
  stages: Record<string, StageScoreSummary>;
}

export interface RunMeta {
  schemaVersion: number;
  runId: string;
  timestamp: string;
  model: string;
  url: string;
  variant: string;
  stages: StageName[];
  datasetPath: string;
  repeat: number;
  gitCommit?: string;
  gitDirty?: boolean;
  promptHashes: Record<string, string>;
  /** Hashes sha256 (16 hex chars) del contenido de los archivos src/ importados. */
  sourceHashes: Record<string, string>;
  params: Record<string, unknown>;
}
