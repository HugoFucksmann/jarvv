/**
 * eval/core/stages/continuation.ts
 *
 * Etapa `continuation` (hilo de conversación): ¿el pedido nuevo continúa la tarea anterior?
 * Evalúa `DECISION_PROMPTS.buildContinuation({ previous: { request, answer }, request })`
 * con umbral `CONTINUATION_APPROVE` (0.3).
 */

import { CONTINUATION_APPROVE, CONTINUATION_KEY, previousTaskOf } from "../contract.ts";
import { LatencyGrader } from "../graders/common.ts";
import { ContinuationLabelGrader } from "../graders/label.ts";
import type { ChoiceQ, ContinuationExpect, ContinuationOutput, NoulQ } from "../types.ts";
import { extractNoul, parseAnswers } from "../variants/labels.ts";
import { checkRange01, NO, YES } from "./shared.ts";
import type { DecisionStageEntry } from "./types.ts";

export const continuationStage: DecisionStageEntry<ContinuationOutput, ContinuationExpect> = {
  stageName: "continuation",
  requestType: "decision",
  expectSpec: {
    keys: { expectedFollows: "boolean", minProbability: "number", maxProbability: "number", answers: "object" },
    required: ["expectedFollows"],
    validate(expectObj, errs) {
      checkRange01(expectObj, ["minProbability", "maxProbability"], errs);
      if (expectObj.minProbability !== undefined && expectObj.expectedFollows === false) {
        errs.push("expect.minProbability contradice expectedFollows=false (la probabilidad medida es la de 'sí').");
      }
      if (expectObj.maxProbability !== undefined && expectObj.expectedFollows === true) {
        errs.push("expect.maxProbability contradice expectedFollows=true (la probabilidad medida es la de 'sí').");
      }
    },
  },
  graders: [LatencyGrader, ContinuationLabelGrader],
  buildRequest(sc, ov, h) {
    const thread = sc.recalled?.thread;
    const prevRequest = thread?.previous_request ?? "";
    const rawAnswer = thread?.previous_answer ?? "";
    // Igual que producción (`previousTaskOf`): recorta con `…` tras `.trim()`.
    const previous = previousTaskOf(prevRequest, rawAnswer);

    return h.decision(
      h.effectivePrompts(ov).D.buildContinuation({
        previous,
        request: sc.request,
      }),
    );
  },
  validateRequest(req) {
    if (!req.questions[CONTINUATION_KEY] || req.questions[CONTINUATION_KEY].type !== "noul") {
      return `continuation requiere pregunta noul '${CONTINUATION_KEY}'.`;
    }
    return null;
  },
  parseOutput(rawOutput: string): ContinuationOutput {
    const answers = parseAnswers(rawOutput);
    const probability = extractNoul(answers, CONTINUATION_KEY);
    return { follows: probability >= CONTINUATION_APPROVE, probability };
  },
  label(output, expect) {
    return {
      predicted: output ? (output.follows ? YES : NO) : null,
      expected: expect ? (expect.expectedFollows ? YES : NO) : null,
      rawScore: output?.probability ?? null,
      probabilities: output ? { [CONTINUATION_KEY]: output.probability } : null,
    };
  },
  mainQuestionBindings(req, canonicalExpected) {
    return req.questions[CONTINUATION_KEY] === undefined
      ? []
      : [{ question: CONTINUATION_KEY, expected: canonicalExpected }];
  },
  oracleAnswer(key, q: ChoiceQ | NoulQ, expect) {
    if (q.type !== "noul" || key !== CONTINUATION_KEY) return undefined;
    return expect.expectedFollows;
  },
};
