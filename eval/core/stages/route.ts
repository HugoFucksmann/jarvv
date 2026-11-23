/**
 * eval/core/stages/route.ts
 *
 * Etapa `route` (Decisión 1): elegir ruta ejecutable.
 */

import { EXECUTABLE_ROUTES, isExecutableRoute, routeInput, routeViewOptions } from "../contract.ts";
import { offeredRoutes } from "../offered.ts";
import { LatencyGrader } from "../graders/common.ts";
import { RouteLabelGrader } from "../graders/label.ts";
import type { ChoiceQ, DecisionRequest, NoulQ, RouteExpect, RouteOutput } from "../types.ts";
import { DecisionParseError, mainChoice, parseAnswers } from "../variants/labels.ts";
import { checkRange01, checkRoute } from "./shared.ts";
import type { DecisionStageEntry } from "./types.ts";

export const routeStage: DecisionStageEntry<RouteOutput, RouteExpect> = {
  stageName: "route",
  requestType: "decision",
  shortcutQuestion: "route",
  expectSpec: {
    keys: { expectedRoute: "string", minProbability: "number", answers: "object" },
    required: ["expectedRoute"],
    validate(expectObj, errs) {
      checkRoute("expectedRoute", expectObj.expectedRoute, errs);
      checkRange01(expectObj, ["minProbability"], errs);
    },
  },
  graders: [LatencyGrader, RouteLabelGrader],
  buildRequest(sc, ov, h) {
    const { ctx } = h.buildContext(sc);
    return h.decision(h.effectivePrompts(ov).D.buildRouteChoice(routeInput(ctx.view.forRoute(routeViewOptions()), { routes: offeredRoutes() })));
  },
  validateRequest(req) {
    if (req.questions.route?.type !== "choice") {
      return "route requiere pregunta choice 'route'.";
    }
    return null;
  },
  parseOutput(rawOutput: string, sentReq: DecisionRequest): RouteOutput {
    const { choice, probabilities } = mainChoice("route", "route", parseAnswers(rawOutput), sentReq);
    if (isExecutableRoute(choice)) return { route: choice, probabilities };
    throw new DecisionParseError(`La ruta '${choice}' no es válida (${EXECUTABLE_ROUTES.join("|")}).`);
  },
  label(output, expect) {
    const predicted = output?.route ?? null;
    const expected = expect?.expectedRoute ?? null;
    const rawScore = output?.probabilities && predicted !== null ? (output.probabilities[predicted] ?? null) : null;
    return { predicted, expected, rawScore, probabilities: output?.probabilities ?? null };
  },
  mainQuestionBindings(req, canonicalExpected) {
    return req.questions.route === undefined ? [] : [{ question: "route", expected: canonicalExpected }];
  },
  oracleAnswer(_key, q: ChoiceQ | NoulQ, expect) {
    return q.type === "choice" ? expect.expectedRoute : undefined;
  },
};
