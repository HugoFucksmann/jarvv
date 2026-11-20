/**
 * eval/core/stages/continuation.ts
 *
 * Etapa `continuation` (hilo de conversación): ¿el pedido nuevo continúa la tarea anterior?
 * Evalúa `DECISION_PROMPTS.buildContinuation({ previous: { request, answer }, request })`
 * con umbral `CONTINUATION_APPROVE` (0.3).
 */

import { CONTINUATION_APPROVE, CONTINUATION_KEY } from "../contract.ts";
import { LatencyGrader } from "../graders/common.ts";
import { ContinuationLabelGrader } from "../graders/label.ts";
import type { ChoiceQ, ContinuationExpect, ContinuationOutput, DecisionReaders, DecisionRequest, NoulQ } from "../types.ts";
import { extractNoul, parseAnswers, readAllAnswers } from "../variants/labels.ts";
import type { DecisionStageEntry } from "./index.ts";
import { checkRange01, NO, YES } from "./shared.ts";

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
    const prevAnswer = rawAnswer.length > 500 ? rawAnswer.slice(0, 500) : rawAnswer;

    return h.decision(
      h.effectivePrompts(ov).D.buildContinuation({
        previous: {
          request: prevRequest,
          answer: prevAnswer,
        },
        request: sc.request,
      }),
    );
  },
  parseOutput(rawOutput: string, sentReq: DecisionRequest, read: DecisionReaders | undefined): ContinuationOutput {
    const answers = parseAnswers(rawOutput);
    const reader = read?.continuation;
    if (reader) {
      const out = reader(readAllAnswers(sentReq, answers));
      return {
        follows: out.follows ?? out.probability >= CONTINUATION_APPROVE,
        probability: out.probability,
      };
    }
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
