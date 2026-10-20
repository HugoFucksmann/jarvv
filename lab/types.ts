/**
 * JARVIS Lab — Definiciones y Contratos de Tipos
 *
 * Exclusivamente tipos internos del laboratorio.
 * No importa de src/ ni de ninguna librería externa.
 */

export type Stage =
  | "decision_one"
  | "arguments"
  | "decision_two"
  | "step_verification"
  | "plan"
  | "replan"
  | "stage_verification"
  | "final_response";

export type Split = "dev" | "test";

// ============================================================
// Tipos de preguntas y respuestas de Decision (Eos)
// ============================================================

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
  | DecisionQuestionNoul
  | { type: string; instructions?: string; [key: string]: unknown };

export interface DecisionAnswerChoice {
  choice: string;
  probabilities?: Record<string, number>;
}

export interface DecisionAnswerNoul {
  noul: number;
}

export type DecisionAnswer = DecisionAnswerChoice | DecisionAnswerNoul;

// ============================================================
// Entradas específicas por etapa
// ============================================================

export interface CaseInputDecisionOne {
  state: string;
  questions: Record<string, DecisionQuestion>;
}

export interface CaseInputArguments {
  system?: string;
  user: string;
  schema: Record<string, unknown>;
  toolName?: string;
}

// ============================================================
// Checks para expectativas (expect)
// ============================================================

export interface CheckValidJson {
  type: "valid_json";
}

export interface CheckChoiceEquals {
  type: "choice_equals";
  expected: string;
  questionKey?: string;
}

export interface CheckMatchesSchema {
  type: "matches_schema";
}

export interface CheckFieldEquals {
  type: "field_equals";
  path: string;
  expected: unknown;
}

export type CaseCheck =
  | CheckValidJson
  | CheckChoiceEquals
  | CheckMatchesSchema
  | CheckFieldEquals;

// ============================================================
// Estructura de un Caso del Laboratorio
// ============================================================

export interface CaseSource {
  taskId: string;
  seq: number | string;
}

export interface CaseReferenceToolRun {
  tool?: string;
  ok?: boolean;
  error?: string | null;
}

export interface CaseReference {
  originalOutput?: string;
  retried?: boolean;
  error?: string | null;
  toolRun?: CaseReferenceToolRun;
}

export interface LabCase<TInput = unknown> {
  id: string;
  stage: Stage;
  split: Split;
  input: TInput;
  expect: CaseCheck[] | null;
  source: CaseSource;
  reference?: CaseReference;
  notes?: string;
}

// ============================================================
// Variantes de Prompt
// ============================================================

export interface VariantDecisionOne {
  questions: Record<
    string,
    {
      instructions?: string;
      criteria?: Record<string, string>;
    }
  >;
}

// ============================================================
// Resultados de Ejecución (RunResult)
// ============================================================

export interface CheckResult {
  check: string;
  passed: boolean;
  message?: string;
}

export interface RunRepetition {
  rep: number;
  latencyMs: number;
  rawOutput: string;
  parsedOutput?: unknown;
  checks: CheckResult[];
  allPassed: boolean;
  expectedChoiceProbability?: number;
  error?: string;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  truncated?: boolean;
}

export interface CaseRunResult {
  caseId: string;
  split: Split;
  passedReps: number;
  totalReps: number;
  avgLatencyMs: number;
  medianLatencyMs?: number;
  expectedChoiceProbability?: number;
  repetitions: RunRepetition[];
}

export interface ModelParametersRecord {
  url: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  numCtx?: number;
  reasoningEffort?: string;
  timeoutMs: number;
}

export interface RunResultSummary {
  totalCasesRun: number;
  pendingCasesSkipped: number;
  totalRepetitions: number;
  successfulRepetitions: number;
  successRatePct: number;
  avgLatencyMs: number;
  medianLatencyMs?: number;
  jsonErrors: number;
  schemaErrors: number;
  truncatedCount?: number;
}

export interface WarmupResult {
  latencyMs: number;
  ok: boolean;
  error?: string;
}

export interface RunResult {
  id: string;
  timestamp: string;
  stage: Stage;
  promptType: "stable" | "variant";
  variantId?: string;
  split?: Split;
  promptUsed: unknown;
  stablePromptHash: string;
  casePromptHashes?: Record<string, string>;
  modelParameters: ModelParametersRecord;
  repetitionsConfig: number;
  warmup?: WarmupResult;
  cases: CaseRunResult[];
  summary: RunResultSummary;
}
