/**
 * eval/core/stages/args_review.ts
 *
 * Etapa `args_review` (Decisión 3): revisar argumentos propuestos antes de ejecutar.
 */

import { ARGS_REVIEWS, reviewInput, reviewOutcome, reviewViewOptions } from "../contract.ts";
import { LatencyGrader } from "../graders/common.ts";
import { ArgsReviewLabelGrader } from "../graders/label.ts";
import type { ArgsReviewExpect, ArgsReviewOutput, ChoiceQ, DecisionRequest, NoulQ } from "../types.ts";
import { DecisionParseError, mainChoice, parseAnswers } from "../variants/labels.ts";
import { checkRange01 } from "./shared.ts";
import type { DecisionStageEntry } from "./types.ts";

export const argsReviewStage: DecisionStageEntry<ArgsReviewOutput, ArgsReviewExpect> = {
  stageName: "args_review",
  requestType: "decision",
  expectSpec: {
    keys: { expectedReview: "string", minProbability: "number", answers: "object" },
    required: ["expectedReview"],
    enums: { expectedReview: ARGS_REVIEWS as readonly string[] },
    validate(expectObj, errs) {
      checkRange01(expectObj, ["minProbability"], errs);
    },
  },
  graders: [LatencyGrader, ArgsReviewLabelGrader],
  buildRequest(sc, ov, h) {
    const { ctx } = h.buildContext(sc);
    const at = sc.at ?? {};
    const route = h.need(at.route, "route", "args_review");
    const tool = h.toolOf(route, h.need(at.tool, "tool", "args_review"), at.inputSchema);
    return h.decision(h.effectivePrompts(ov).D.buildArgsReview(reviewInput(ctx.view.forReview(reviewViewOptions()), route, tool, at.args ?? {})));
  },
  validateRequest(req) {
    const rev = req.questions.review;
    if (!rev || rev.type !== "choice") return "args_review requiere pregunta choice 'review'.";
    for (const opt of ARGS_REVIEWS) {
      if (!(opt in rev.criteria)) return `questions.review.criteria debe incluir '${opt}'.`;
    }
    return null;
  },
  parseOutput(rawOutput: string, sentReq: DecisionRequest): ArgsReviewOutput {
    const answers = parseAnswers(rawOutput);
    const result = mainChoice("args_review", "review", answers, sentReq);
    if (!(ARGS_REVIEWS as readonly string[]).includes(result.choice)) {
      throw new DecisionParseError(`'${result.choice}' no es un valor válido de revisión (${ARGS_REVIEWS.join("|")}).`);
    }
    // Como producción (`callRunner`): aprueba solo si P(approved) llega al umbral; si no, el rechazo más probable.
    const review = reviewOutcome({ review: result.choice as (typeof ARGS_REVIEWS)[number], probabilities: result.probabilities });
    return { review, probabilities: result.probabilities };
  },
  label(output, expect) {
    const predicted = output?.review ?? null;
    const expected = expect?.expectedReview ?? null;
    const rawScore = output?.probabilities && predicted !== null ? (output.probabilities[predicted] ?? null) : null;
    return { predicted, expected, rawScore, probabilities: output?.probabilities ?? null };
  },
  mainQuestionBindings(req, canonicalExpected) {
    return req.questions.review === undefined ? [] : [{ question: "review", expected: canonicalExpected }];
  },
  oracleAnswer(_key, q: ChoiceQ | NoulQ, expect) {
    return q.type === "choice" ? expect.expectedReview : undefined;
  },
};
