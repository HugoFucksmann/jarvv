/**
 * scripts/eval-next/core/stages/plan.ts
 *
 * Etapa PLAN (LLM 1): Planificación inicial y replanificación unificada.
 * Usa PLAN_VIEW de producción, renderPlan, planViewSchema y parsePlanSteps.
 */

import { PROMPTS } from "../../../../src/core/reasoner/prompts.ts";
import { parseJsonObject, parsePlanSteps, stripThink } from "../../../../src/core/reasoner/qwen.ts";
import { renderPlan } from "../../../../src/core/render/plan.ts";
import { planRenderOptions } from "../../../../src/core/engine/adapters.ts";
import { buildCompactCatalog } from "../../../../src/core/tools/manifest.ts";
import { LatencyGrader, NonEmptyOutputGrader, NotTruncatedGrader } from "../graders/common.ts";
import { PlanStepsGrader } from "../graders/plan.ts";
import type {
  GenerativeModelRequest,
  ParseResult,
  PlanExpect,
  PlanInput,
  PlanOutput,
  PromptVariant,
  StageDefinition,
} from "../types.ts";

/** Schema para salida estructurada del LLM en modo plan (equivalente a planViewSchema de qwen.ts) */
export function buildPlanViewSchema(maxSteps: number): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            goal: { type: "string" },
            suggested_mcp: { type: "string" },
            expected_outcome: { type: "string" },
          },
          required: ["goal", "suggested_mcp", "expected_outcome"],
          additionalProperties: false,
        },
        minItems: 1,
        maxItems: maxSteps,
      },
    },
    required: ["steps"],
    additionalProperties: false,
  };
}

export const PlanStage: StageDefinition<PlanInput, PlanOutput, PlanExpect> = {
  name: "plan",
  defaultClient: "generative",
  defaultThinking: true,
  maxTokensKey: "plan",

  build(input: PlanInput, variant: PromptVariant): GenerativeModelRequest {
    let viewText: string;
    if (input.mode === "raw") {
      viewText = input.text;
    } else {
      viewText = renderPlan(input.view, planRenderOptions()).text;
    }

    const catalog = input.catalog ?? buildCompactCatalog();
    const system = variant.systemOverride || PROMPTS.PLAN_VIEW.SYSTEM;
    const user = PROMPTS.PLAN_VIEW.buildUserPrompt({
      view: viewText,
      maxSteps: input.maxSteps,
      catalog,
    });

    const schema = buildPlanViewSchema(input.maxSteps);

    return {
      type: "generative",
      system,
      user: variant.userPrefix ? `${variant.userPrefix}\n${user}` : user,
      json: true,
      schema,
      thinking: true,
    };
  },

  parse(raw: string): ParseResult<PlanOutput> {
    const cleaned = stripThink(raw).trim();
    if (!cleaned) {
      return { ok: false, error: "Salida del plan vacía tras remover <think>." };
    }

    const parsed = parseJsonObject(cleaned);
    if (!parsed || !Array.isArray(parsed.steps)) {
      return { ok: false, error: "La salida no contiene un objeto JSON con el array 'steps'." };
    }

    const res = parsePlanSteps(parsed.steps, 1, false);
    if ("error" in res) {
      return { ok: false, error: res.error };
    }

    return {
      ok: true,
      value: {
        steps: res.steps.map((s) => ({
          goal: s.instruction,
          suggested_mcp: s.route,
          expected_outcome: s.expectedOutcome,
        })),
      },
    };
  },

  graders: [NotTruncatedGrader, NonEmptyOutputGrader, LatencyGrader, PlanStepsGrader],
};

