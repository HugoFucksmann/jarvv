/**
 * eval/prompts/core/types.ts
 *
 * Tipos del eval de prompts (esquema v2). Sin imports de `src/` ni de `scripts/eval-next/`.
 * Secciones del documento: 5.1 caso frozen, 5.2 expect/output, 5.3 variantes, 5.4 resultados, 8 graders, 9 scoring.
 */

import type { ToolInputSchema } from "./contract.ts";

/** Versión del esquema de salida. Incrementar al cambiar campos incompatibles. */
export const SCHEMA_VERSION = 2 as const;

// ───────────────────────── Etapas ─────────────────────────

export type DecisionStage = "route" | "tool_choice" | "args_review" | "result_verification";
export type GenerativeStage = "plan" | "arguments" | "final" | "question";
export type StageName = DecisionStage | GenerativeStage;

// ───────────────────────── 5.1 Caso frozen ─────────────────────────

export type ChoiceQ = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type NoulQ = { type: "noul"; instructions: string };

export interface DecisionRequest {
  type: "decision";
  state: string;
  /** Al menos una pregunta. Se envían tal cual (se conservan campos adicionales). */
  questions: Record<string, ChoiceQ | NoulQ>;
}

export interface GenerativeRequest {
  type: "generative";
  system: string;
  /** Ya incluye todo lo que producción envía. */
  user: string;
  /** true → pide JSON. */
  json: boolean;
  /** Con schema → json_schema; json sin schema → json_object; sin json → sin response_format. */
  schema?: Record<string, unknown>;
  /** Default "plan"; solo aplica con schema. */
  schemaName?: string;
  maxTokens: number;
  temperature: number;
  thinking: boolean;
  /** Gana sobre `thinking`. */
  reasoningEffort?: string;
}

export interface FrozenCase {
  /** Único dentro del dataset. */
  id: string;
  stage: StageName;
  /** Default []. */
  tags?: string[];
  description?: string;
  /** Adversarial: se reporta aparte. */
  isRaw?: boolean;
  /** Debe coincidir con el tipo de la etapa. */
  request: DecisionRequest | GenerativeRequest;
  expect: StageExpect;
  meta?: {
    /** `arguments`: inputSchema real de la herramienta; se usa para `validateArgs`, no se envía al modelo. */
    toolSchema?: ToolInputSchema;
    origin?: { id: string; commit?: string };
  };
}

// ───────────────────────── 5.2 Expect y Output por etapa ─────────────────────────

// route
export interface RouteExpect {
  expectedAction: "route" | "fin" | "ask_user";
  expectedRoute?: string;
  minProbability?: number;
}
export interface RouteOutput {
  action: string;
  route?: string;
  probabilities?: Record<string, number>;
}

// tool_choice
export interface ToolChoiceExpect {
  expectedTool?: string;
  expectedAction?: "tool" | "ask_user";
  minProbability?: number;
}
export interface ToolChoiceOutput {
  selected: string;
  probabilities?: Record<string, number>;
}

// args_review
export interface ArgsReviewExpect {
  expectedReview: "approved" | "args_invalid" | "tool_rejected" | "info_missing";
  minProbability?: number;
}
export interface ArgsReviewOutput {
  review: string;
  probabilities?: Record<string, number>;
}

// result_verification
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

// plan
export interface PlanStep {
  goal: string;
  suggested_mcp: string;
  expected_outcome: string;
}
export interface PlanOutput {
  steps: PlanStep[];
}
export interface PlanExpect {
  minSteps?: number;
  maxSteps?: number;
  allowedRoutes?: string[];
  requiredRoutes?: string[];
  firstRoute?: string;
  requiredKeywordsInGoal?: string[];
  forbiddenKeywordsInGoal?: string[];
  /** Replan por fallo: no repetir metas ya falladas. */
  forbiddenRepeatedGoals?: string[];
  /** Replan por fallo: no repetir efectos o mutaciones ya ejecutadas. */
  forbiddenExecutedEffects?: string[];
  /** Replan por feedback: incorporar instrucciones o términos clave del usuario. */
  mustReflectFeedback?: string[];
}

// arguments
export interface ArgumentsOutput {
  args: Record<string, unknown>;
}
export interface ArgumentsExpect {
  requiredFields?: string[];
  exactFieldValues?: Record<string, unknown>;
  allowedRefTokens?: string[];
  forbiddenHardcodedValues?: string[];
}

// final
export interface FinalOutput {
  response: string;
}
export interface FinalExpect {
  mustContainFacts?: string[];
  mustMentionEffects?: string[];
  forbiddenHallucinations?: string[];
}

// question
export interface QuestionOutput {
  question: string;
}
export interface QuestionExpect {
  maxChars?: number;
  mustContainKeywords?: string[];
  forbiddenKeywords?: string[];
  singleQuestionOnly?: boolean;
}

export type StageExpect =
  | RouteExpect
  | ToolChoiceExpect
  | ArgsReviewExpect
  | ResultVerificationExpect
  | PlanExpect
  | ArgumentsExpect
  | FinalExpect
  | QuestionExpect;

// ───────────────────────── 5.3 Variantes ─────────────────────────

export type TextEdit = { replace?: string; prepend?: string; append?: string } | ((t: string) => string);
/** Orden de aplicación: remove → set → append. */
export type CriteriaEdit = { set?: Record<string, string>; remove?: string[]; append?: Record<string, string> };

export interface DecisionStageVariant {
  state?: TextEdit;
  questions?: Record<string, { instructions?: TextEdit; criteria?: CriteriaEdit; replace?: ChoiceQ | NoulQ }>;
  addQuestions?: Record<string, ChoiceQ | NoulQ>;
  removeQuestions?: string[];
  /** Opción de la variante → nombre canónico. */
  labelMap?: Record<string, string>;
  /** `<campo de salida>` → pregunta, o `{question, trueOption}` para derivar un booleano de una pregunta `choice`. */
  answerMap?: Record<string, string | { question: string; trueOption: string }>;
}

export interface GenerativeStageVariant {
  system?: TextEdit;
  user?: TextEdit;
  params?: {
    thinking?: boolean;
    maxTokens?: number;
    temperature?: number;
    schema?: Record<string, unknown>;
    reasoningEffort?: string;
  };
}

export interface Variant {
  /** Debe coincidir con el nombre del archivo. */
  name: string;
  decision?: Partial<Record<DecisionStage, DecisionStageVariant>>;
  generative?: Partial<Record<GenerativeStage, GenerativeStageVariant>>;
}

// ───────────────────────── 5.4 Resultados ─────────────────────────

/** Valores de `--thinking` (ver 7.5). */
export type ThinkingMode = "auto" | "prod" | "on" | "off" | "both";

export interface RunRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  dataset: string;
  caseId: string;
  stage: StageName;
  /** Ver 7.5. */
  stageKey: string;
  /** 1..repeat. */
  iteration: number;
  variant: string;
  variantChain: string[];
  /** Modelo que respondió (generativo o de decisión). */
  model: string;
  passed: boolean;
  isRaw?: boolean;
  prodShortcut?: boolean;
  /** raw = isRaw, o prodShortcut sin --include-shortcut. */
  bucket: "canonical" | "raw";
  errors: string[];
  warnings: string[];
  metrics: Record<string, boolean>;
  measurements: Record<string, number | string>;
  predictedLabel?: string | null;
  expectedLabel?: string | null;
  probabilities?: Record<string, number> | null;
  rawScore?: number | null;
  requestParams?: {
    temperature?: number;
    thinking?: boolean;
    maxTokens?: number;
    timeoutMs?: number;
  };
  /** sha256 (16 hex) del request ya transformado. */
  requestHash: string;
  /** Request transformado (lo que se envió). */
  rawInput: unknown;
  rawOutput: string;
  parsedOutput?: unknown;
  durationMs: number;
  tokens?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  /** Decisión: tokens estimados (caracteres/3). */
  tokensEstimated?: boolean;
  finishReason?: string;
  timestamp: string;
}

export interface RunMeta {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  timestamp: string;
  model: string;
  decisionModel: string;
  /** Siempre "d3" (único backend soportado); se conserva por compatibilidad del esquema. */
  backend: "d3";
  url: string;
  decisionUrl: string;
  variantChain: string[];
  variantHash: string;
  datasetPath: string;
  datasetHash: string;
  stages: StageName[];
  repeat: number;
  gitCommit?: string;
  gitDirty?: boolean;
  params: {
    timeoutMs?: number;
    concurrency: number;
    thinking: ThinkingMode;
    client: "real" | "mock" | "oracle";
    includeShortcut: boolean;
    label?: string;
  };
}

// ───────────────────────── 8 Graders ─────────────────────────

export interface GraderContext {
  rawOutput: string;
  finishReason?: string;
  durationMs: number;
}

export interface GraderCollector {
  /** Falla el caso si `ok=false`. */
  check(key: string, ok: boolean, errorMessage: string): boolean;
  /** Solo warning. */
  soft(key: string, ok: boolean, warningMessage: string): boolean;
  measure(key: string, value: number | string): void;
}

export interface Grader<TOutput, TExpect> {
  name: string;
  grade(
    output: TOutput | undefined,
    expect: TExpect,
    ctx: GraderContext,
    collector: GraderCollector,
  ): void;
}

// ───────────────────────── 9 Scoring ─────────────────────────

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
  stageKey: string;
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
  /** Runs canónicos cuya llamada al cliente falló (red/timeout/HTTP). Cuentan como falla en passRate pero no en latencias. */
  clientFailedRuns?: number;
  /** Runs del bucket raw (excluidos del passRate canónico). */
  rawTotalRuns: number;
  rawPassedRuns: number;
  rawPassRate: number;
  cases: CaseScoreSummary[];
}

export interface GlobalScoreSummary {
  schemaVersion: typeof SCHEMA_VERSION;
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  /** Fracción de casos con passAll=true (consistencia global). */
  passAllRate: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  /** Runs canónicos con llamada fallida (ver `StageScoreSummary.clientFailedRuns`). */
  clientFailedRuns?: number;
  rawTotalRuns: number;
  rawPassedRuns: number;
  rawPassRate: number;
  /** Indexado por `stageKey`. */
  stages: Record<string, StageScoreSummary>;
}
