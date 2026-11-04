/**
 * scripts/eval-next/core/stages/args_review.ts
 *
 * Etapa Decisión #3: Revisión de llamada candidata (approved, args_invalid, tool_rejected, info_missing).
 * Usa DECISION_PROMPTS.buildArgsReview de producción.
 */

import { DECISION_PROMPTS } from "../../../../src/core/reasoner/prompts.ts";
import { NotTruncatedGrader, LatencyGrader } from "../graders/common.ts";
import { ArgsReviewLabelGrader } from "../graders/label.ts";
import type {
  ArgsReviewExpect,
  ArgsReviewInput,
  ArgsReviewOutput,
  DecisionModelRequest,
  ParseResult,
  PromptVariant,
  StageDefinition,
} from "../types.ts";

export const ArgsReviewStage: StageDefinition<ArgsReviewInput, ArgsReviewOutput, ArgsReviewExpect> = {
  name: "args_review",
  defaultClient: "decision",
  defaultThinking: false,

  build(input: ArgsReviewInput, _variant: PromptVariant): DecisionModelRequest {
    const { state, questions } = DECISION_PROMPTS.buildArgsReview(input);
    return {
      type: "decision",
      backend: "d3",
      state,
      questions,
    };
  },

  parse(raw: string): ParseResult<ArgsReviewOutput> {
    try {
      const data = typeof raw === "object" && raw !== null ? raw : JSON.parse(raw);
      const answer = data.answers?.review || data.review || data;
      const choice = answer.choice;
      if (!choice || typeof choice !== "string") {
        return { ok: false, error: "Respuesta no contiene un campo 'choice' de review válido." };
      }
      return {
        ok: true,
        value: {
          review: choice,
          probabilities: answer.probabilities,
        },
      };
    } catch (e: any) {
      return { ok: false, error: `Error parseando respuesta de Decisión #3: ${e.message}` };
    }
  },

  graders: [NotTruncatedGrader, LatencyGrader, ArgsReviewLabelGrader],
};

