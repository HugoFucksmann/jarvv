/**
 * eval/core/stages/index.ts
 *
 * Registro central de etapas. Cada `StageEntry` conecta nombre, tipo de request,
 * parser y graders. Los stages deben registrarse aquí para que `case.ts` y el
 * runner (F4) los reconozcan.
 *
 * Secciones: 3, 7.6, 7.7.
 */

import type { DecisionClient } from "../client/decision.ts";
import type { GenerativeClient } from "../client/generative.ts";
import type { ToolInputSchema } from "../contract.ts";
import type { Grader, GraderCollector, GraderContext, StageName } from "../types.ts";
import type { DecisionReaders } from "../types.ts";

// ───────────────────────── Tipos del registro ─────────────────────────

/** Info de etiqueta producida por cada etapa para el registro RunRecord. */
export interface LabelInfo {
  predicted: string | null;
  expected: string | null;
  rawScore: number | null;
  probabilities: Record<string, number> | null;
}

/** Entrada del registro para una etapa de decisión. */
export interface DecisionStageEntry<TOutput, TExpect> {
  stageName: StageName;
  requestType: "decision";
  /** Lista de graders a ejecutar (en orden). */
  graders: Grader<TOutput, TExpect>[];
  /** Parsea el texto crudo de la respuesta. Lanza en error de parseo. */
  parseOutput(
    rawOutput: string,
    sentReq: import("../types.ts").DecisionRequest,
    read: DecisionReaders | undefined,
  ): TOutput;
  /** Calcula etiquetas para scoring (7.8). */
  label(output: TOutput | undefined, expect: TExpect | undefined): LabelInfo;
}

/** Entrada del registro para una etapa generativa. */
export interface GenerativeStageEntry<TOutput, TExpect> {
  stageName: StageName;
  requestType: "generative";
  graders: Grader<TOutput, TExpect>[];
  /** Parsea el texto crudo de la respuesta (ya sin <think> para final/question). Lanza en error. */
  parseOutput(
    rawOutput: string,
    sentReq: import("../types.ts").GenerativeRequest,
    toolSchema?: ToolInputSchema,
  ): TOutput;
  label(output: TOutput | undefined, expect: TExpect | undefined): LabelInfo;
}

export type StageEntry<TOutput = unknown, TExpect = unknown, TReq = unknown> =
  TReq extends import("../types.ts").DecisionRequest
    ? DecisionStageEntry<TOutput, TExpect>
    : GenerativeStageEntry<TOutput, TExpect>;

// ───────────────────────── Registro ─────────────────────────

import { argsReviewStage, fragmentJudgeStage, resultVerificationStage, routeStage, toolChoiceStage } from "./decision.ts";
import { argumentsStage, finalStage, pendingStage, planStage, questionStage } from "./generative.ts";

/** Registro indexado por nombre de etapa. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY = new Map<StageName, DecisionStageEntry<any, any> | GenerativeStageEntry<any, any>>([
  ["route", routeStage],
  ["tool_choice", toolChoiceStage],
  ["args_review", argsReviewStage],
  ["result_verification", resultVerificationStage],
  ["fragment_judge", fragmentJudgeStage],
  ["plan", planStage],
  ["arguments", argumentsStage],
  ["final", finalStage],
  ["question", questionStage],
  ["pending", pendingStage],
]);

export function getStage(name: StageName): DecisionStageEntry<unknown, unknown> | GenerativeStageEntry<unknown, unknown> {
  const entry = REGISTRY.get(name);
  if (!entry) throw new Error(`Etapa '${name}' no registrada.`);
  return entry;
}

export function allStageNames(): StageName[] {
  return [...REGISTRY.keys()];
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

