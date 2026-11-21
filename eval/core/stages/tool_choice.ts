/**
 * eval/core/stages/tool_choice.ts
 *
 * Etapa `tool_choice` (Decisión 2): elegir herramienta dentro de la ruta.
 */

import { routeViewOptions, SYSTEM_TOOL_MANIFEST, toolInput } from "../contract.ts";
import { LatencyGrader } from "../graders/common.ts";
import { ToolChoiceLabelGrader } from "../graders/label.ts";
import type { ChoiceQ, DecisionRequest, NoulQ, ToolChoiceExpect, ToolChoiceOutput } from "../types.ts";
import { mainChoice, parseAnswers } from "../variants/labels.ts";
import { checkRange01 } from "./shared.ts";
import type { DecisionStageEntry } from "./types.ts";

export const toolChoiceStage: DecisionStageEntry<ToolChoiceOutput, ToolChoiceExpect> = {
  stageName: "tool_choice",
  requestType: "decision",
  shortcutQuestion: "selected_tool",
  expectSpec: {
    keys: { expectedTool: "string", minProbability: "number", answers: "object" },
    required: ["expectedTool"],
    validate(expectObj, errs) {
      checkRange01(expectObj, ["minProbability"], errs);
    },
  },
  graders: [LatencyGrader, ToolChoiceLabelGrader],
  buildRequest(sc, ov, h) {
    const { ctx } = h.buildContext(sc);
    const at = sc.at ?? {};
    const route = h.need(at.route, "route", "tool_choice");
    // Sin `at.tools`, las herramientas de la ruta que el motor ofrece: las internas (las de etapa 1) no se ofrecen a D2 en producción.
    const names = at.tools ?? SYSTEM_TOOL_MANIFEST.filter((d) => d.route === route && d.internal !== true).map((d) => d.name);
    const tools = names.map((n) => h.toolOf(route, n));
    return h.decision(h.effectivePrompts(ov).D.buildToolChoice(toolInput(ctx.view.forRoute(routeViewOptions(route)), route, tools)));
  },
  validateRequest(req) {
    if (!req.questions.selected_tool || req.questions.selected_tool.type !== "choice") {
      return "tool_choice requiere pregunta choice 'selected_tool'.";
    }
    return null;
  },
  parseOutput(rawOutput: string, sentReq: DecisionRequest): ToolChoiceOutput {
    const { choice, probabilities } = mainChoice("tool_choice", "selected_tool", parseAnswers(rawOutput), sentReq);
    return { selected: choice, probabilities };
  },
  label(output, expect) {
    const predicted = output?.selected ?? null;
    const expected = expect?.expectedTool ?? null;
    const rawScore = output?.probabilities && predicted !== null ? (output.probabilities[predicted] ?? null) : null;
    return { predicted, expected, rawScore, probabilities: output?.probabilities ?? null };
  },
  mainQuestionBindings(req, canonicalExpected) {
    return req.questions.selected_tool === undefined ? [] : [{ question: "selected_tool", expected: canonicalExpected }];
  },
  oracleAnswer(_key, q: ChoiceQ | NoulQ, expect) {
    if (q.type !== "choice") return undefined;
    return typeof expect.expectedTool === "string" ? expect.expectedTool : Object.keys(q.criteria)[0];
  },
};
