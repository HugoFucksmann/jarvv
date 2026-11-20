/**
 * eval/core/stages/index.ts
 *
 * Registro central de etapas enchufables. Cada etapa vive en su propio módulo en `eval/core/stages/`
 * y declara aquí su esquema de `expect`, construcción de request, parser, graders y oráculo.
 * Agregar una etapa nueva al eval requiere solo su módulo en `stages/`, variantes y dataset.
 */

import type { ConfigManager } from "../../../src/core/config.ts";
import type { TaskContext } from "../../../src/core/ctx/index.ts";
import type { PrecheckSources } from "../../../src/core/engine/precheck.ts";
import type { UserEnvironment } from "../../../src/core/environment.ts";
import type { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { PromptSet, StageRequest } from "../../../src/core/models/stageRequests.ts";
import type { MCPTool } from "../../../src/core/types.ts";
import type { ExecutableRoute } from "../../../src/core/types/routes.ts";
import type { DecisionClient } from "../client/decision.ts";
import type { GenerativeCallContext, GenerativeClient, PreparedRequest } from "../client/generative.ts";
import type { ToolInputSchema, VariantPrompts } from "../contract.ts";
import type { Materialized, Scenario, ScenarioAt } from "../scenario.ts";
import type {
  Case,
  ChoiceQ,
  DecisionReaders,
  DecisionRequest,
  DecisionStage,
  GenerativeRequest,
  Grader,
  GraderCollector,
  GraderContext,
  NoulQ,
  StageName,
} from "../types.ts";

// ───────────────────────── Tipos del registro ─────────────────────────

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
  /** Parsea el texto crudo de la respuesta. Lanza en error de parseo. */
  parseOutput(
    rawOutput: string,
    sentReq: DecisionRequest,
    read: DecisionReaders | undefined,
  ): TOutput;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStageEntry = DecisionStageEntry<any, any> | GenerativeStageEntry<any, any>;

export type StageEntry<TOutput = unknown, TExpect = unknown, TReq = unknown> =
  TReq extends DecisionRequest
    ? DecisionStageEntry<TOutput, TExpect>
    : GenerativeStageEntry<TOutput, TExpect>;

// ───────────────────────── Registro ─────────────────────────

import { argsReviewStage } from "./args_review.ts";
import { argumentsStage } from "./arguments.ts";
import { d0Stage } from "./d0.ts";
import { d5Stage } from "./d5.ts";
import { finalStage } from "./final.ts";
import { fragmentJudgeStage } from "./fragment_judge.ts";
import { continuationStage } from "./continuation.ts";
import { pendingStage } from "./pending.ts";
import { planStage } from "./plan.ts";
import { questionStage } from "./question.ts";
import { recoveryStage } from "./recovery.ts";
import { resultVerificationStage } from "./result_verification.ts";
import { routeStage } from "./route.ts";
import { toolChoiceStage } from "./tool_choice.ts";

/** Registro indexado por nombre de etapa. */
const REGISTRY = new Map<StageName, AnyStageEntry>([
  ["d0", d0Stage],
  ["route", routeStage],
  ["tool_choice", toolChoiceStage],
  ["args_review", argsReviewStage],
  ["result_verification", resultVerificationStage],
  ["fragment_judge", fragmentJudgeStage],
  ["d5", d5Stage],
  ["recovery", recoveryStage],
  ["continuation", continuationStage],
  ["plan", planStage],
  ["arguments", argumentsStage],
  ["final", finalStage],
  ["question", questionStage],
  ["pending", pendingStage],
]);

export function hasStage(name: string): name is StageName {
  return REGISTRY.has(name as StageName);
}

export function getStage(name: StageName): DecisionStageEntry<unknown, unknown> | GenerativeStageEntry<unknown, unknown> {
  const entry = REGISTRY.get(name);
  if (!entry) throw new Error(`Etapa '${name}' no registrada.`);
  return entry as DecisionStageEntry<unknown, unknown> | GenerativeStageEntry<unknown, unknown>;
}

export function allStageNames(): StageName[] {
  return [...REGISTRY.keys()];
}

export function stageNamesByType(type: "decision" | "generative"): StageName[] {
  return [...REGISTRY.values()].filter((e) => e.requestType === type).map((e) => e.stageName);
}

export function isDecisionStage(name: string): name is DecisionStage {
  return REGISTRY.get(name as StageName)?.requestType === "decision";
}

// ───────────────────────── Runner helpers ─────────────────────────

/**
 * Ejecuta los graders de una etapa y devuelve el resultado del collector.
 * Se llama desde el runner (F4).
 */
export function runGraders<TOutput, TExpect>(
  entry: DecisionStageEntry<TOutput, TExpect> | GenerativeStageEntry<TOutput, TExpect>,
  output: TOutput | undefined,
  expect: TExpect,
  ctx: GraderContext,
  collector: GraderCollector,
): void {
  for (const grader of entry.graders as Grader<TOutput, TExpect>[]) {
    grader.grade(output, expect, ctx, collector);
  }
}

// ───────────────────────── Clientes (usado en F4) ─────────────────────────

export type Clients = {
  generative: GenerativeClient;
  decision: DecisionClient;
};
