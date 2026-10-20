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
  taskId?: string;
  iterationId?: string;
  originalOutput?: string;
}

export interface LabCase<TInput = unknown> {
  id: string;
  stage: Stage;
  split: Split;
  input: TInput;
  expect: CaseCheck[] | null;
  source: CaseSource;
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
  error?: string;
}

export interface CaseRunResult {
  caseId: string;
  split: Split;
  passedReps: number;
  totalReps: number;
  avgLatencyMs: number;
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
  jsonErrors: number;
  schemaErrors: number;
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
  modelParameters: ModelParametersRecord;
  repetitionsConfig: number;
  cases: CaseRunResult[];
  summary: RunResultSummary;
}
