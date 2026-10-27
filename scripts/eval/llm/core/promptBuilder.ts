import { PROMPTS as PROD_PROMPTS } from "../../../../src/core/reasoner/prompts.ts";
import { PLAN_JSON_SCHEMA, REPLAN_JSON_SCHEMA } from "../../../../src/core/reasoner/qwen.ts";
import { buildCompactCatalog } from "../../../../src/core/tools/manifest.ts";
import type { QwenMaxTokens } from "../../../../src/core/config.ts";
import type { LlmEvalStage, LlmTestCase } from "./types.ts";

export type PromptsSet = typeof PROD_PROMPTS;

export interface StageSpec {
    json: boolean;
    schema?: Record<string, unknown>;
    /** Thinking por defecto de la etapa en producción (el caso puede sobreescribirlo). final_response: lo gobierna config.thinking. */
    thinking: boolean;
    /** Clave de config.qwenMaxTokens que usa producción para esta etapa. */
    maxTokensKey: keyof QwenMaxTokens;
}

export const STAGE_SPECS: Record<LlmEvalStage, StageSpec> = {
    plan: { json: true, schema: PLAN_JSON_SCHEMA, thinking: true, maxTokensKey: "plan" },
    replan: { json: true, schema: REPLAN_JSON_SCHEMA, thinking: true, maxTokensKey: "replan" },
    arguments: { json: true, thinking: false, maxTokensKey: "arguments" },
    final_response: { json: false, thinking: false, maxTokensKey: "final" },
};

export interface BuiltPrompt {
    system: string;
    user: string;
    /** "prod": armado con PROMPTS de producción o variante externa. "raw": texto escrito a mano en el caso. */
    source: "prod" | "raw";
}

export function buildPrompt(c: LlmTestCase, customPrompts?: any): BuiltPrompt {
    const p = c.input.prompt;
    if (!p) return { system: c.input.system ?? "", user: c.input.user ?? "", source: "raw" };

    if (p.stage !== c.stage) {
        throw new Error(`Caso ${c.id}: input.prompt.stage '${p.stage}' no coincide con stage '${c.stage}'.`);
    }

    const prompts = {
        PLAN: customPrompts?.PLAN ?? PROD_PROMPTS.PLAN,
        REPLAN: customPrompts?.REPLAN ?? PROD_PROMPTS.REPLAN,
        ARGUMENTS: customPrompts?.ARGUMENTS ?? PROD_PROMPTS.ARGUMENTS,
        FINAL_RESPONSE: customPrompts?.FINAL_RESPONSE ?? PROD_PROMPTS.FINAL_RESPONSE,
    };

    switch (p.stage) {
        case "plan":
            return {
                system: prompts.PLAN.SYSTEM,
                user: prompts.PLAN.buildUserPrompt(
                    p.goal,
                    p.chatContext,
                    p.compactCatalog || buildCompactCatalog(),
                    p.modificationFeedback,
                    p.existingPlanSummary
                ),
                source: "prod",
            };
        case "replan":
            return { system: prompts.REPLAN.SYSTEM, user: prompts.REPLAN.buildUserPrompt(p.data), source: "prod" };
        case "arguments":
            return { system: prompts.ARGUMENTS.SYSTEM, user: prompts.ARGUMENTS.buildUserPrompt(p.data), source: "prod" };
        case "final_response":
            return {
                system: prompts.FINAL_RESPONSE.SYSTEM,
                user: prompts.FINAL_RESPONSE.buildUserPrompt(p.data),
                source: "prod",
            };
    }
}