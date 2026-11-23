/**
 * eval/core/stages/types.ts
 *
 * Contratos de tipos e interfaces del registro de etapas y materialización de escenarios.
 * Extraído fuera de `stages/index.ts` y `scenario.ts` para evitar dependencias circulares de tipos.
 */

import type {
  CallStatus,
  ConfigManager,
  DECISION_PROMPTS,
  ExecutableRoute,
  JsonObject,
  MCPTool,
  PrecheckSources,
  PromptSet,
  StageRequest,
  StepState,
  StopReason,
  TaskContext,
  TerminalTaskState,
  ToolInputSchema,
  UserEnvironment,
  VariantPrompts,
  VerdictReason,
} from "../contract.ts";
import type { GenerativeCallContext, PreparedRequest } from "../client/generative.ts";
import type {
  Case,
  ChoiceQ,
  DecisionRequest,
  GenerativeRequest,
  Grader,
  GraderCollector,
  NoulQ,
  StageName,
} from "../types.ts";

// ───────────────────────── Escenario y materialización ─────────────────────────

export interface ScenarioStep {
  /** Deliberativo: la del plan. Reactivo: el primer pendiente (default: la solicitud). */
  instruction?: string;
  route?: string;
  expected?: string;
  /** Estado final del paso (default `pending`). `completed` y `failed` pasan antes por `running`. */
  state?: StepState;
}

export interface ScenarioCall {
  /** Índice del paso en `steps` (default: el último). */
  step?: number;
  route: string;
  tool: string;
  /** Default `read`. */
  kind?: "read" | "write";
  status: CallStatus;
  /** Default `{}`; `null` solo con `args_invalid`. */
  args?: JsonObject | null;
  summary?: string | null;
  verdict?: "approved" | "rejected";
  reason?: VerdictReason | null;
  /** Resultado guardado aparte: el resumen no lo contiene completo. */
  ref?: { label: string; size: number; where: string };
}

/** Parámetros del punto de decisión; cada etapa lee solo los suyos. */
export interface ScenarioAt {
  // tool_choice, args_review, arguments: la ruta. Las opciones de `route` y de `tool_choice` no se declaran en el caso: son las del backend (ver `offeredRoutes` y `offeredTools`).
  route?: ExecutableRoute;
  /** args_review y arguments: herramienta (nombre del manifest) con su schema de entrada. */
  tool?: string;
  inputSchema?: ToolInputSchema;
  /** args_review: argumentos propuestos. */
  args?: JsonObject;
  // result_verification: índice de la llamada evaluada en `calls` (default: la última).
  call?: number;
  /** result_verification: el ítem verificado es el último; la variante recibe `request` (la solicitud completa). */
  lastItem?: boolean;
  // plan: instrucción del usuario (replan por feedback).
  feedback?: string;
  // pending: la lista de pendientes de la vuelta anterior (vacía o ausente en la primera vuelta).
  previous?: string[];
  // recovery: la causa del fallo (`StepFailureCause`) y los pasos fallidos del ítem hasta ahora (default 1). `previous` trae la lista de la vuelta con el ítem fallido de primero.
  cause?: string;
  attempts?: number;
  // fragment_judge: la necesidad (la pregunta de `web_search`) y los fragmentos a puntuar (hasta `JUDGE_BATCH`). No usa el resto del escenario.
  need?: string;
  fragments?: string[];
  // arguments: rutas del usuario (default fijo, para que el caso no dependa de la PC) e intentos previos rechazados de la herramienta.
  environment?: { home: string; desktop?: string; documents?: string; downloads?: string };
  priorAttempts?: number;
}

export interface ScenarioRecalled {
  /** Hechos del usuario (`source: "user_memory"`): `{ key, value }`, como los devuelve `MemoryProvider.recall`. */
  user_memory?: Array<{ key: string; value: string; from?: string }>;
  /** Hilo reciente (`source: "thread"`): las dos entradas que usa producción. */
  thread?: { previous_request?: string; previous_answer?: string };
}

export interface Scenario {
  mode: "reactive" | "deliberative";
  request: string;
  steps?: ScenarioStep[];
  calls?: ScenarioCall[];
  /** Hechos de entorno (hoy solo `process`). */
  facts?: Record<string, string>;
  /** Aportes recuperados de memoria (`user_memory` y `thread`: `previous_request`, `previous_answer`). */
  recalled?: ScenarioRecalled;
  /** Respuestas del usuario a preguntas anteriores (`answer_<paso>_<n>`), en orden. */
  userInput?: string[];
  /** Cierre de la tarea (para `final`). */
  finish?: { state: TerminalTaskState; stopReason?: StopReason | null };
  at?: ScenarioAt;
}

export interface Materialized {
  request: DecisionRequest | GenerativeRequest;
  /** `arguments`: schema real de la herramienta, para validar la salida. */
  toolSchema?: ToolInputSchema;
  /** `arguments`: herramienta y entorno del caso, para repetir el pre-chequeo de producción sobre la salida. */
  toolName?: string;
  environment?: UserEnvironment;
  /** `arguments`: `kind` de la herramienta y fuentes de la tarea, como los arma producción (`callRunner`); completan ese pre-chequeo. */
  precheck?: { kind: "read" | "write"; sources: PrecheckSources };
  /** `args_review`: producción exige el umbral estricto (`BUDGET.sensitiveApprove`) para esta llamada (nivel amarillo o lista negra `sensitive`). */
  reviewStrict?: boolean;
}

// ───────────────────────── Registro de etapas ─────────────────────────

/** Info de etiqueta producida por cada etapa para el registro RunRecord. */
export interface LabelInfo {
  predicted: string | null;
  expected: string | null;
  rawScore: number | null;
  probabilities: Record<string, number> | null;
}

export type ExpectKind = "string" | "number" | "boolean" | "string[]" | "boolean[]" | "object";

export interface ExpectSpec {
  keys: Record<string, ExpectKind>;
  /** Al menos una de estas claves debe estar presente (un `expect` sin ningún check no es válido). */
  atLeastOne?: string[];
  required?: string[];
  enums?: Record<string, readonly string[]>;
  /** Validaciones semánticas específicas de la etapa sobre `expect`. */
  validate?: (expectObj: Record<string, unknown>, errs: string[], request?: unknown) => void;
}

export interface MainBinding {
  question: string;
  expected: string | null;
}

export interface ScenarioHelpers {
  buildContext(sc: Scenario): { ctx: TaskContext; callIds: string[] };
  effectivePrompts(ov?: VariantPrompts): { P: PromptSet; D: typeof DECISION_PROMPTS };
  decision(d: { state: string; questions: unknown }): Materialized;
  generative(r: StageRequest, schemaName?: string): GenerativeRequest;
  precheckBase(
    ctx: TaskContext,
    route: ExecutableRoute,
    toolName: string,
    atEnvironment: ScenarioAt["environment"],
  ): { kind: "read" | "write"; sources: PrecheckSources; environment: UserEnvironment };
  toolOf(route: ExecutableRoute, name: string, inputSchema?: ToolInputSchema): MCPTool;
  need<T>(value: T | undefined, what: string, stage: string): T;
  config(): ReturnType<typeof ConfigManager.getConfig>;
}

export interface OracleHelpers {
  rec(v: unknown): Record<string, unknown>;
  strs(v: unknown): string[];
  num(v: unknown): number | undefined;
  firstAlt(terms: string[]): string[];
  allAlts(terms: string[]): string[];
  fold(s: string): string;
  mockPlanRoute(prepared: PreparedRequest): string;
}

export interface GenerativePostCheckContext<TOutput> {
  parsed: TOutput;
  fc: Case;
  collector: GraderCollector;
}

/** Entrada del registro para una etapa de decisión. */
export interface DecisionStageEntry<TOutput, TExpect> {
  stageName: StageName;
  requestType: "decision";
  /** Pregunta cuya única opción dispara el atajo de producción (`prod_shortcut`). */
  shortcutQuestion?: string;
  expectSpec: ExpectSpec;
  /** Lista de graders a ejecutar (en orden). */
  graders: Grader<TOutput, TExpect>[];
  buildRequest(sc: Scenario, ov: VariantPrompts | undefined, h: ScenarioHelpers): Materialized;
  /** Valida que el DecisionRequest generado por una variante cumpla los invariantes mínimos de la etapa. */
  validateRequest?(req: DecisionRequest, fc: Case): string | null;
  /** Parsea el texto crudo de la respuesta. Lanza en error de parseo. */
  parseOutput(rawOutput: string, sentReq: DecisionRequest, fc?: Case): TOutput;
  /** Calcula etiquetas para scoring (7.8). */
  label(output: TOutput | undefined, expect: TExpect | undefined): LabelInfo;
  /** Preguntas principales que alimentan la salida canónica de la etapa. */
  mainQuestionBindings(req: DecisionRequest, canonicalExpected: string | null, expect: TExpect): MainBinding[];
  /** Respuesta ideal del oráculo para una pregunta de esta etapa. */
  oracleAnswer(key: string, q: ChoiceQ | NoulQ, expect: TExpect): string | boolean | undefined;
}

/** Entrada del registro para una etapa generativa. */
export interface GenerativeStageEntry<TOutput, TExpect> {
  stageName: StageName;
  requestType: "generative";
  /** true → una salida truncada (`finishReason === "length"`) se rechaza siempre. */
  rejectTruncated: boolean;
  expectSpec: ExpectSpec;
  graders: Grader<TOutput, TExpect>[];
  buildRequest(sc: Scenario, ov: VariantPrompts | undefined, h: ScenarioHelpers): Materialized;
  /** Valida que el GenerativeRequest generado por una variante cumpla los invariantes mínimos de la etapa. */
  validateRequest?(req: GenerativeRequest, fc: Case): string | null;
  /** Parsea el texto crudo de la respuesta (ya sin <think> para final/question). Lanza en error. */
  parseOutput(
    rawOutput: string,
    sentReq: GenerativeRequest,
    toolSchema?: ToolInputSchema,
  ): TOutput;
  label(output: TOutput | undefined, expect: TExpect | undefined): LabelInfo;
  /** Chequeos deterministas posteriores sobre la salida parseada (solo cliente real). */
  postCheck?: (ctx: GenerativePostCheckContext<TOutput>) => Promise<void> | void;
  /** Salida sintética válida para `--client=oracle`. */
  oracleOutput(
    prepared: PreparedRequest,
    ctx: GenerativeCallContext | undefined,
    expect: Record<string, unknown>,
    h: OracleHelpers,
  ): string;
}

// El registro guarda etapas con tipos de salida y de `expect` distintos: solo `any` acepta todas las instancias a la vez.
// biome-ignore lint/suspicious/noExplicitAny: registro heterogéneo de etapas
export type AnyStageEntry = DecisionStageEntry<any, any> | GenerativeStageEntry<any, any>;
