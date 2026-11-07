/**
 * eval/core/types.ts
 *
 * Tipos del eval de prompts (esquema v2). Sin imports de `src/` ni de `scripts/eval-next/`.
 * Secciones del documento: 5.1 caso frozen, 5.2 expect/output, 5.3 variantes, 5.4 resultados, 8 graders, 9 scoring.
 */

import type { PromptOverrides, ToolInputSchema } from "./contract.ts";

/** Versión del esquema de salida. Incrementar al cambiar campos incompatibles. */
export const SCHEMA_VERSION = 2 as const;

// ───────────────────────── Etapas ─────────────────────────

export type DecisionStage = "route" | "tool_choice" | "args_review" | "result_verification";
export type GenerativeStage = "plan" | "arguments" | "final" | "question" | "pending";
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

export type CaseSource = "frozen" | "scenario";

export interface FrozenCase {
  /** Único dentro del dataset. */
  id: string;
  stage: StageName;
  /** Default []. */
  tags?: string[];
  description?: string;
  /** Adversarial: se reporta aparte. */
  isRaw?: boolean;
  /**
   * Origen del contexto: `frozen` = prompt escrito a mano en el dataset (`request`); `scenario` = armado al cargar con el
   * código de Jarvis desde un escenario. Lo asigna el cargador; un dataset no puede traerlo.
   */
  source?: CaseSource;
  /** Lo asigna la carga por variante si una edición no se pudo aplicar a este caso; el runner lo registra y no llama al modelo. */
  variantApplyError?: string;
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

/**
 * Respuesta esperada de una pregunta **adicional** de una decisión (la define el caso o la agrega una variante).
 * `choice` para preguntas `choice`; `yes` para `noul`. Se evalúa por clave de pregunta, sin pisar las demás.
 */
export interface AnswerExpect {
  choice?: string;
  yes?: boolean;
  /** `choice`: probabilidad de la opción esperada. `noul`: probabilidad de "sí" (solo con `yes: true`). */
  minProbability?: number;
}
export type AnswerExpects = Record<string, AnswerExpect>;

// route
export interface RouteExpect {
  expectedAction: "route" | "fin" | "ask_user";
  expectedRoute?: string;
  minProbability?: number;
  answers?: AnswerExpects;
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
  answers?: AnswerExpects;
}
export interface ToolChoiceOutput {
  selected: string;
  probabilities?: Record<string, number>;
}

// args_review
export interface ArgsReviewExpect {
  expectedReview: "approved" | "args_invalid" | "tool_rejected" | "info_missing";
  minProbability?: number;
  answers?: AnswerExpects;
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
  answers?: AnswerExpects;
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

// pending (lista de pendientes del reactivo)
export interface PendingOutput {
  pending: string[];
}
export interface PendingExpect {
  /** `true`: la lista debe venir vacía (nada por hacer); `false`: debe tener al menos un pendiente. */
  expectEmpty?: boolean;
  maxItems?: number;
  /** Palabras que debe contener el primer pendiente (la instrucción del paso). */
  requiredKeywordsInFirst?: string[];
  /** Palabras que no puede contener ningún pendiente (por ejemplo, un comando o herramienta inventados). */
  forbiddenKeywords?: string[];
}

export type StageExpect =
  | RouteExpect
  | ToolChoiceExpect
  | ArgsReviewExpect
  | ResultVerificationExpect
  | PlanExpect
  | ArgumentsExpect
  | FinalExpect
  | QuestionExpect
  | PendingExpect;

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
  /**
   * Prompts enteros (piezas de `PROMPTS` y `DECISION_PROMPTS` que reemplaza). Solo aplica a casos por escenario, que se
   * rearman al cargar con estos prompts; en un caso fijo se ignora. Las ediciones de abajo se aplican después.
   */
  prompts?: PromptOverrides;
  decision?: Partial<Record<DecisionStage, DecisionStageVariant>>;
  generative?: Partial<Record<GenerativeStage, GenerativeStageVariant>>;
}

// ───────────────────────── 5.4 Resultados ─────────────────────────

/** Valores de `--thinking` (ver 7.5). */
export type ThinkingMode = "auto" | "prod" | "on" | "off" | "both";

/**
 * Resultado de UNA pregunta de una decisión. Se registra una entrada por cada pregunta enviada, indexada por su
 * clave: las respuestas y métricas de varias preguntas en el mismo request conviven sin pisarse.
 */
export interface QuestionResult {
  type: "choice" | "noul";
  /** main = alimenta la salida canónica de la etapa; extra = pregunta adicional (caso o variante). */
  role: "main" | "extra";
  /** `choice`: opción elegida (canónica si es la principal y hay `labelMap`). `noul`: "yes" o "no" (> 0.5). null = sin respuesta válida. */
  answer: string | null;
  /** Opción tal como la respondió el modelo, solo si difiere de `answer` (por `labelMap`). */
  rawAnswer?: string;
  /** Valor `noul` en [0,1] (probabilidad de "sí"). */
  noul?: number;
  probabilities?: Record<string, number>;
  /** Respuesta esperada ("yes"/"no" en `noul`); null si el caso no fija expectativa para esta pregunta. */
  expected: string | null;
  /** null = sin expectativa. Sin respuesta válida con expectativa cuenta como false. */
  correct: boolean | null;
  /** Por qué no hay respuesta válida. Afecta solo a esta pregunta. */
  error?: string;
}

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
  /** Decisión: una entrada por pregunta enviada, por clave. */
  questions?: Record<string, QuestionResult>;
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
  /** Modelo generativo. */
  model: string;
  /** Modelo de decisión. */
  decisionModel: string;
  url: string;
  decisionUrl: string;
  variantChain: string[];
  variantHash: string;
  datasetPath: string;
  datasetHash: string;
  stages: StageName[];
  /**
   * Filtros de la corrida. `datasetHash` es el del archivo completo: sin esto no se sabe qué subconjunto corrió. Vacío o
   * null = sin ese filtro.
   */
  filters: { tags: string[]; ids: string[]; source: CaseSource | null; limit: number | null };
  /** Casos que corrió la celda y hash de sus ids ordenados: mismo hash = mismos casos. */
  cases: { count: number; hash: string };
  /** Fecha (`TODAY`) y hash de la configuración de etapas con que se armaron los prompts por escenario. */
  promptEnv: { date: string; stageConfigHash: string };
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

/** Métricas de una clase de una pregunta, una-contra-resto. FP = se predijo la clase y no era; FN = era y no se predijo. */
export interface ClassScore {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
}

export interface QuestionScore {
  /** Runs con expectativa para esta pregunta (denominador de accuracy). */
  graded: number;
  correct: number;
  accuracy: number;
  /** Runs graduados sin respuesta válida (cuentan como error). */
  unanswered: number;
  role: "main" | "extra";
  /** esperado → predicho. */
  confusionMatrix: Record<string, Record<string, number>>;
  /** Por clase. En `noul` la clase positiva es "yes". */
  perClass: Record<string, ClassScore>;
}

/** Cruce de dos preguntas del mismo request: en cuántos runs acertó cada una. */
export interface QuestionCross {
  a: string;
  b: string;
  runs: number;
  bothCorrect: number;
  onlyA: number;
  onlyB: number;
  bothWrong: number;
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
  /** Llamadas completadas detrás de avg/p50/p95. Con 0, esas latencias valen 0 pero no significan "0ms": no hay dato. */
  latencySamples: number;
  /** Aciertos de etiqueta sobre las decisiones con respuesta (no incluye llamadas fallidas ni casos sin etiqueta esperada). */
  accuracy?: number;
  confusionMatrix?: Record<string, Record<string, number>>;
  /** Solo en etapas con 2 o más preguntas evaluadas: métricas por pregunta y cruces entre ellas. */
  questions?: Record<string, QuestionScore>;
  questionCross?: QuestionCross[];
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
  /** Ver `StageScoreSummary.latencySamples`. Ojo: p50/p95 globales mezclan etapas de decisión y generativas. */
  latencySamples: number;
  /** Runs canónicos con llamada fallida (ver `StageScoreSummary.clientFailedRuns`). */
  clientFailedRuns?: number;
  rawTotalRuns: number;
  rawPassedRuns: number;
  rawPassRate: number;
  /** Indexado por `stageKey`. */
  stages: Record<string, StageScoreSummary>;
}
