/**
 * scripts/eval-next/core/stages/index.ts
 *
 * Registro central de etapas de evaluación de JARVIS.
 * Añadir una etapa nueva consiste únicamente en crear su archivo e incluirla aquí.
 */

import type { StageDefinition, StageName } from "../types.ts";
import { RouteStage } from "./route.ts";
import { ToolChoiceStage } from "./tool_choice.ts";
import { ArgsReviewStage } from "./args_review.ts";
import { ResultVerificationStage } from "./result_verification.ts";
import { PlanStage } from "./plan.ts";
import { ArgumentsStage } from "./arguments.ts";
import { FinalStage } from "./final.ts";
import { QuestionStage } from "./question.ts";

export const STAGES_REGISTRY: Record<StageName, StageDefinition<any, any, any>> = {
  route: RouteStage,
  tool_choice: ToolChoiceStage,
  args_review: ArgsReviewStage,
  result_verification: ResultVerificationStage,
  plan: PlanStage,
  arguments: ArgumentsStage,
  final: FinalStage,
  question: QuestionStage,
};

// Compile-time check: every StageName must be present in STAGES_REGISTRY.
// If you add a value to StageName in types.ts but forget to register it here, tsc will error.
const _registryCoversAllStages: Record<StageName, unknown> = STAGES_REGISTRY;
void _registryCoversAllStages;

export function getStageDefinition(name: string): StageDefinition<any, any, any> {
  const stage = STAGES_REGISTRY[name as StageName];
  if (!stage) {
    const available = Object.keys(STAGES_REGISTRY).join(", ");
    throw new Error(`Etapa desconocida '${name}'. Etapas registradas: ${available}`);
  }
  return stage;
}

export function getAllStageNames(): StageName[] {
  return Object.keys(STAGES_REGISTRY) as StageName[];
}

