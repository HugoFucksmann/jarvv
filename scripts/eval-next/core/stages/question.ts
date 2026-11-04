/**
 * scripts/eval-next/core/stages/question.ts
 *
 * Etapa QUESTION (ask_user): Formulación de preguntas aclaratorias directas al usuario.
 * Usa QUESTION de producción y renderAsk.
 */

import { PROMPTS } from "../../../../src/core/reasoner/prompts.ts";
import { stripThink } from "../../../../src/core/reasoner/qwen.ts";
import { renderAsk } from "../../../../src/core/render/ask.ts";
import { askRenderOptions } from "../../../../src/core/engine/adapters.ts";
import { LatencyGrader, NonEmptyOutputGrader, NotTruncatedGrader } from "../graders/common.ts";
import { QuestionGrader } from "../graders/question.ts";
import type {
  GenerativeModelRequest,
  ParseResult,
  PromptVariant,
  QuestionExpect,
  QuestionInput,
  QuestionOutput,
  StageDefinition,
} from "../types.ts";

export const QuestionStage: StageDefinition<QuestionInput, QuestionOutput, QuestionExpect> = {
  name: "question",
  defaultClient: "generative",
  defaultThinking: false,

  build(input: QuestionInput, variant: PromptVariant): GenerativeModelRequest {
    let viewText: string;
    if (input.mode === "raw") {
      viewText = input.text;
    } else {
      viewText = renderAsk(input.view, askRenderOptions());
    }

    const system = variant.systemOverride || PROMPTS.QUESTION.SYSTEM;
    const user = PROMPTS.QUESTION.buildUserPrompt({ view: viewText });

    return {
      type: "generative",
      system,
      user: variant.userPrefix ? `${variant.userPrefix}\n${user}` : user,
      json: false,
      thinking: false,
      maxTokens: 300,
    };
  },

  parse(raw: string): ParseResult<QuestionOutput> {
    const text = stripThink(raw).trim();
    if (!text) {
      return { ok: false, error: "Pregunta vacía tras remover <think>." };
    }
    return {
      ok: true,
      value: { question: text },
    };
  },

  graders: [NotTruncatedGrader, NonEmptyOutputGrader, LatencyGrader, QuestionGrader],
};

