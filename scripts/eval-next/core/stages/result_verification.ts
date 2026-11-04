/**
 * scripts/eval-next/core/stages/result_verification.ts
 *
 * Etapa Decisión #4: Verificación de resultado de llamada (ok, cumple con preguntas noul).
 * Usa DECISION_PROMPTS.buildResultVerification de producción.
 */

import { DECISION_PROMPTS } from "../../../../src/core/reasoner/prompts.ts";
import { NotTruncatedGrader, LatencyGrader } from "../graders/common.ts";
import { ResultVerificationGrader } from "../graders/label.ts";
import type {
  DecisionModelRequest,
  ParseResult,
  PromptVariant,
  ResultVerificationExpect,
  ResultVerificationInput,
  ResultVerificationOutput,
  StageDefinition,
} from "../types.ts";

export const ResultVerificationStage: StageDefinition<
  ResultVerificationInput,
  ResultVerificationOutput,
  ResultVerificationExpect
> = {
  name: "result_verification",
  defaultClient: "decision",
  defaultThinking: false,

  build(input: ResultVerificationInput, _variant: PromptVariant): DecisionModelRequest {
    const { state, questions } = DECISION_PROMPTS.buildResultVerification(input);
    return {
      type: "decision",
      backend: "d3",
      state,
      questions,
    };
  },

  parse(raw: string): ParseResult<ResultVerificationOutput> {
    try {
      const data = typeof raw === "object" && raw !== null ? raw : JSON.parse(raw);
      const answers = data.answers || data;

      const okAns = answers.ok;
      const cumpleAns = answers.cumple;

      const okProb = typeof okAns?.noul === "number" ? okAns.noul : typeof okAns === "number" ? okAns : 0.5;
      const cumpleProb = typeof cumpleAns?.noul === "number" ? cumpleAns.noul : typeof cumpleAns === "number" ? cumpleAns : 0.5;

      return {
        ok: true,
        value: {
          ok: okProb > 0.5,
          cumple: cumpleProb > 0.5,
          okProbability: okProb,
          cumpleProbability: cumpleProb,
        },
      };
    } catch (e: any) {
      return { ok: false, error: `Error parseando respuesta de Decisión #4: ${e.message}` };
    }
  },

  graders: [NotTruncatedGrader, LatencyGrader, ResultVerificationGrader],
};

