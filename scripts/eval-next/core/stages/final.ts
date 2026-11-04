/**
 * scripts/eval-next/core/stages/final.ts
 *
 * Etapa FINAL (LLM 3): Síntesis de la respuesta final al usuario.
 * Usa FINAL_VIEW de producción y renderFinal.
 */

import { PROMPTS } from "../../../../src/core/reasoner/prompts.ts";
import { stripThink } from "../../../../src/core/reasoner/qwen.ts";
import { renderFinal } from "../../../../src/core/render/final.ts";
import type { FinalView } from "../../../../src/core/ctx/index.ts";
import { finalRenderOptions } from "../../../../src/core/engine/adapters.ts";
import { LatencyGrader, NonEmptyOutputGrader, NotTruncatedGrader } from "../graders/common.ts";
import { FinalResponseGrader } from "../graders/final.ts";
import type {
  FinalExpect,
  FinalInput,
  FinalOutput,
  GenerativeModelRequest,
  ParseResult,
  PromptVariant,
  StageDefinition,
} from "../types.ts";

export const FinalStage: StageDefinition<FinalInput, FinalOutput, FinalExpect> = {
  name: "final",
  defaultClient: "generative",
  defaultThinking: false,
  maxTokensKey: "final",

  build(input: FinalInput, variant: PromptVariant): GenerativeModelRequest {
    let viewText: string;
    if (input.mode === "raw") {
      viewText = input.text;
    } else {
      const v = input.view as any;
      const normalizedView: FinalView = {
        request: v.request ?? "",
        task: v.task ?? { note: "Tarea completada exitosamente." },
        steps: v.steps ?? v.stepsDone ?? [],
        lastReads:
          v.lastReads ??
          (v.data
            ? v.data.map((d: string) => ({
                kind: "read",
                status: "ok",
                summary: d,
                ref: null,
                args: null,
                failed: false,
                statusNote: null,
                reasonNote: null,
              }))
            : []),
        evidence: v.evidence ?? [],
        userInput: v.userInput ?? [],
        env: v.env ?? [],
        effects: v.effects ?? [],
        possibleEffects: v.possibleEffects ?? [],
      };
      viewText = renderFinal(normalizedView, finalRenderOptions()).text;
    }

    const system = variant.systemOverride || PROMPTS.FINAL_VIEW.SYSTEM;
    const user = PROMPTS.FINAL_VIEW.buildUserPrompt({ view: viewText });

    return {
      type: "generative",
      system,
      user: variant.userPrefix ? `${variant.userPrefix}\n${user}` : user,
      json: false,
      thinking: false,
    };
  },

  parse(raw: string): ParseResult<FinalOutput> {
    const text = stripThink(raw).trim();
    if (!text) {
      return { ok: false, error: "Respuesta final vacía tras remover <think>." };
    }
    return {
      ok: true,
      value: { response: text },
    };
  },

  graders: [NotTruncatedGrader, NonEmptyOutputGrader, LatencyGrader, FinalResponseGrader],
};

