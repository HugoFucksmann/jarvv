/**
 * eval/core/stages/index.ts
 *
 * Registro central de etapas enchufables. Cada etapa vive en su propio módulo en `eval/core/stages/`
 * y declara aquí su esquema de `expect`, construcción de request, parser, graders y oráculo.
 * Agregar una etapa nueva al eval requiere solo su módulo en `stages/`, variantes y dataset.
 */

import type { DecisionStage, Grader, GraderCollector, GraderContext, StageName } from "../types.ts";
import type { AnyStageEntry, DecisionStageEntry, GenerativeStageEntry } from "./types.ts";

export type {
  AnyStageEntry,
  DecisionStageEntry,
  ExpectKind,
  ExpectSpec,
  GenerativePostCheckContext,
  GenerativeStageEntry,
  LabelInfo,
  MainBinding,
  OracleHelpers,
  ScenarioHelpers,
} from "./types.ts";

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
