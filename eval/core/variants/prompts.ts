/**
 * eval/core/variants/prompts.ts
 *
 * Helper compartido para fusionar los prompts y parámetros de una `Variant` sobre los de producción (`src/`).
 * Lo consumen tanto `scenario.ts` (datasets) como los constructores y ejecutores reales del Modo Jarvis Real,
 * garantizando que una variante produzca exactamente la misma fusión en dataset, aislado y encadenado.
 */

import { DECISION_PROMPTS, PROMPTS } from "../../../src/core/models/prompts.ts";
import type { QwenStageKey } from "../../../src/core/models/qwen.ts";
import type { PromptSet, StageParamsOverride } from "../../../src/core/models/stageRequests.ts";
import type { ParamsOverride, Variant } from "../types.ts";

export interface AppliedVariantPrompts {
  /** Conjunto entero de vistas generativas (`PROMPTS` con las vistas enteras de la variante). */
  readonly prompts: PromptSet;
  /** Conjunto entero de constructores de decisión (`DECISION_PROMPTS` con los de la variante). */
  readonly decisionPrompts: typeof DECISION_PROMPTS;
  /** Sobrescrituras de parámetros generativos por etapa (`plan`, `arguments`, `question`, `pending`, `final`). */
  readonly stageParams: Partial<Record<QwenStageKey, StageParamsOverride>>;
}

function cleanParams(params: ParamsOverride | undefined): StageParamsOverride | undefined {
  if (!params) return undefined;
  const out: StageParamsOverride = {};
  if (params.thinking !== undefined) out.thinking = params.thinking;
  if (params.maxTokens !== undefined) out.maxTokens = params.maxTokens;
  if (params.temperature !== undefined) out.temperature = params.temperature;
  if (params.schema !== undefined) out.schema = params.schema;
  if (params.reasoningEffort !== undefined) out.reasoningEffort = params.reasoningEffort;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Fusiona los prompts enteros y parámetros de una `Variant` sobre los valores de producción.
 * Sin variante (o con `prod`), devuelve copias con todos los constructores de `src/`.
 */
export function applyVariantPrompts(variant?: Pick<Variant, "prompts" | "params">): AppliedVariantPrompts {
  const ov = variant?.prompts;
  const prompts = { ...PROMPTS, ...ov?.PROMPTS } as PromptSet;
  const decisionPrompts: typeof DECISION_PROMPTS = { ...DECISION_PROMPTS, ...ov?.DECISION_PROMPTS };
  const stageParams: Partial<Record<QwenStageKey, StageParamsOverride>> = {};
  for (const stage of ["plan", "arguments", "question", "pending", "final"] as const) {
    const cleaned = cleanParams(variant?.params?.[stage]);
    if (cleaned) stageParams[stage] = cleaned;
  }
  return { prompts, decisionPrompts, stageParams };
}
