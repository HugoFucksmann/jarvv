/**
 * eval/core/stages/args_review.ts
 *
 * Etapa `args_review` (Decisión 3): revisar argumentos propuestos antes de ejecutar.
 */

import {
  approvalTierOf,
  ARGS_REVIEWS,
  blacklistMatch,
  BUDGET,
  compileBlacklist,
  isKnownTool,
  reviewInput,
  reviewOutcome,
  reviewViewOptions,
  serverOf,
} from "../contract.ts";
import { LatencyGrader } from "../graders/common.ts";
import { ArgsReviewLabelGrader } from "../graders/label.ts";
import type { ArgsReviewExpect, ArgsReviewOutput, Case, ChoiceQ, DecisionRequest, NoulQ } from "../types.ts";
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
    const cfg = h.config();
    const args = at.args ?? {};
    const input = reviewInput(ctx.view.forReview(reviewViewOptions()), route, tool, args);
    // Igual que `Decision20Engine.reviewArgs`: la vista completa depende de la configuración.
    const built = h.decision(h.effectivePrompts(ov).D.buildArgsReview(input, { fullView: cfg.reviewFullView === true }));

    // Igual que `evaluatePolicy` + `reviewIfNeeded` (producción): umbral estricto si la escritura es de nivel amarillo
    // (solo con `approvalTiers`) o coincide con una entrada `sensitive` de la lista negra.
    const mcp = serverOf(route);
    const { kind, environment } = h.precheckBase(ctx, route, tool.name, at.environment);
    const tier = cfg.approvalTiers === true && kind === "write" ? (isKnownTool(mcp, tool.name) ? approvalTierOf(tool.name, args, environment) : "red") : null;
    const listed = blacklistMatch(compileBlacklist(cfg.blacklist), mcp, tool.name, kind === "write", args);
    return { ...built, reviewStrict: listed?.level === "sensitive" || tier === "yellow" };
  },
  validateRequest(req) {
    const rev = req.questions.review;
    if (rev?.type !== "choice") return "args_review requiere pregunta choice 'review'.";
    for (const opt of ARGS_REVIEWS) {
      if (!(opt in rev.criteria)) return `questions.review.criteria debe incluir '${opt}'.`;
    }
    return null;
  },
  parseOutput(rawOutput: string, sentReq: DecisionRequest, fc?: Case): ArgsReviewOutput {
    const answers = parseAnswers(rawOutput);
    const result = mainChoice("args_review", "review", answers, sentReq);
    if (!(ARGS_REVIEWS as readonly string[]).includes(result.choice)) {
      throw new DecisionParseError(`'${result.choice}' no es un valor válido de revisión (${ARGS_REVIEWS.join("|")}).`);
    }
    // Como producción (`callRunner`): aprueba solo si P(approved) llega al umbral; si no, el rechazo más probable.
    const strict = fc?.meta?.reviewStrict === true;
    const review = reviewOutcome({ review: result.choice as (typeof ARGS_REVIEWS)[number], probabilities: result.probabilities }, strict ? BUDGET.sensitiveApprove : undefined);
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
