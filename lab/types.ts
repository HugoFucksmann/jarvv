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

/**
 * Umbral canónico de aprobación para preguntas noul en Eos.
 * En producción (src/core/decision.ts:39), se aprueba si probabilidad > 0.5 estricto.
 */
export const NOUL_APPROVE = 0.5;

// ============================================================
// Entradas específicas por modelo (solo dos contratos base)
// ============================================================

/**
 * Entrada estándar para etapas basadas en Eos (Decision 2.0).
 * Aplica a: decision_one, decision_two, step_verification.
 */
export interface CaseInputEos {
  state: string;
  questions: Record<string, DecisionQuestion>;
}

/**
 * Entrada estándar para etapas basadas en Qwen 3.5 9B.
 * Aplica a: arguments, stage_verification, plan, replan, final_response.
 */
export interface CaseInputQwen {
  system?: string;
  user: string;
  /** Schema del tool (conservado para retrocompatibilidad en arguments) */
  schema?: Record<string, unknown>;
  /** Nombre del tool si está presente en el user prompt */
  toolName?: string;
}

// Aliases para retrocompatibilidad
export type CaseInputDecisionOne = CaseInputEos;
export type CaseInputArguments = CaseInputQwen;

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

export interface CheckNoulApproved {
  type: "noul_approved";
  questionKey: string;
  expected: boolean;
}

export interface CheckMatchesSchema {
  type: "matches_schema";
}

export interface CheckFieldEquals {
  type: "field_equals";
  path: string;
  expected: unknown;
}

export interface CheckMinSteps {
  type: "min_steps";
  count: number;
}

export interface CheckMaxSteps {
  type: "max_steps";
  count: number;
}

export interface CheckRoutesAllowed {
  type: "routes_allowed";
  allowedRoutes?: string[];
}

export interface CheckActionEquals {
  type: "action_equals";
  expected: "continue" | "abort";
}

export interface CheckStatusEquals {
  type: "status_equals";
  expected: string;
}

export interface CheckHasQuestionForUser {
  type: "has_question_for_user";
  expected: boolean;
}

export interface CheckContainsText {
  type: "contains_text";
  keywords: string[];
  caseSensitive?: boolean;
}

export interface CheckNotEmpty {
  type: "not_empty";
}

export interface CheckMinLength {
  type: "min_length";
  minChars: number;
}

export type CaseCheck =
  | CheckValidJson
  | CheckChoiceEquals
  | CheckNoulApproved
  | CheckMatchesSchema
  | CheckFieldEquals
  | CheckMinSteps
  | CheckMaxSteps
  | CheckRoutesAllowed
  | CheckActionEquals
  | CheckStatusEquals
  | CheckHasQuestionForUser
  | CheckContainsText
  | CheckNotEmpty
  | CheckMinLength;

// ============================================================
// Estructura de un Caso del Laboratorio
// ============================================================

export interface CaseSource {
  taskId: string;
  seq: number | string;
}

export interface CaseReferenceToolRun {
  callSeq?: number | string;
  step?: number | string | null;
  tool?: string;
  ok?: boolean;
  error?: string | null;
  resultPreview?: string;
}

export interface CaseReference {
  originalOutput?: string;
  retried?: boolean;
  error?: string | null;
  toolRun?: CaseReferenceToolRun;
  /** Parámetros grabados en la llamada de traza (temperature, max_tokens, etc.) */
  recordedParams?: Record<string, unknown>;
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
// Variantes de Prompt para Eos
// ============================================================

export interface VariantDecisionEos {
  questions?: Record<
    string,
    {
      instructions?: string;
      criteria?: Record<string, string>;
    }
  >;
}

export type VariantDecisionOne = VariantDecisionEos;
export type VariantDecisionTwo = VariantDecisionEos;

export interface VariantStepVerification {
  questions?: {
    ok?: { instructions?: string };
    cumple?: { instructions?: string };
    [key: string]: { instructions?: string } | undefined;
  };
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
  /** Probabilidades individuales de noul para step_verification ({ ok: number, cumple: number }) */
  noulProbabilities?: Record<string, number>;
  /** Si Eos aprueba el paso (ok > 0.5 && cumple > 0.5) */
  noulApproved?: boolean;
  /** Cantidad de pasos planificados (plan / replan) */
  planStepCount?: number;
  /** Rutas sugeridas en los pasos (plan / replan) */
  planRoutes?: string[];
  /** Acción de replan ("continue" | "abort") */
  replanAction?: "continue" | "abort";
  /** Estado de stage_verification */
  stageVerificationStatus?: string;
  /** Texto de respuesta final generada (final_response) */
  finalResponseText?: string;
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
  /** Probabilidades promedio de noul para step_verification */
  noulProbabilities?: Record<string, number>;
  /** Si Eos aprueba el paso en la mayoría o promedio de repeticiones */
  noulApproved?: boolean;
  /** Cantidad de pasos planificados (plan / replan) */
  planStepCount?: number;
  /** Rutas sugeridas en los pasos (plan / replan) */
  planRoutes?: string[];
  /** Acción de replan ("continue" | "abort") */
  replanAction?: "continue" | "abort";
  /** Estado promedio o veredicto de stage_verification */
  stageVerificationStatus?: string;
  /** Texto representativo o de primera repetición de final_response */
  finalResponseText?: string;
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

export interface FidelityWarning {
  caseId: string;
  parameter: string;
  recorded: unknown;
  current: unknown;
  message: string;
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
  /** Advertencias de fidelidad respecto a los parámetros y prompt grabados en trazas */
  fidelityWarnings?: FidelityWarning[];
}
