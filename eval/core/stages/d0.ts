/**
 * eval/core/stages/d0.ts
 *
 * Etapa D0: primera consulta de la tarea reactiva (charla, una acción o varias).
 */

import { FIRST_QUERY_KINDS, firstQueryKind } from "../../../src/core/engine/firstQuery.ts";
import { LatencyGrader } from "../graders/common.ts";
import { D0LabelGrader } from "../graders/label.ts";
import type { ChoiceQ, D0Expect, D0Output, DecisionRequest, NoulQ } from "../types.ts";
import { extractNoul, mainChoice, parseAnswers } from "../variants/labels.ts";
import type { DecisionStageEntry } from "./index.ts";

export const d0Stage: DecisionStageEntry<D0Output, D0Expect> = {
  stageName: "d0",
  requestType: "decision",
  expectSpec: {
    keys: { expectedKind: "string", minChatProbability: "number", maxChatProbability: "number", answers: "object" },
    required: ["expectedKind"],
    enums: { expectedKind: FIRST_QUERY_KINDS as readonly string[] },
  },
  graders: [LatencyGrader, D0LabelGrader],
  buildRequest(sc, ov, h) {
    // La primera consulta de la tarea: solo la solicitud, sin contexto (como `Decision20Engine.firstQuery`).
    if (sc.mode !== "reactive") throw new Error("etapa 'd0': la primera consulta solo existe en modo reactivo.");
    return h.decision(h.effectivePrompts(ov).D.buildFirstQuery({ request: sc.request }));
  },
  parseOutput(rawOutput: string, sentReq: DecisionRequest): D0Output {
    const answers = parseAnswers(rawOutput);
    const { probabilities } = mainChoice("d0", "kind", answers, sentReq);
    const multi = sentReq.questions.multi?.type === "noul" ? extractNoul(answers, "multi") : 0;
    return { kind: firstQueryKind(probabilities.chat, multi), probabilities, multi };
  },
  label(output, expect) {
    const predicted = output?.kind ?? null;
    return {
      predicted,
      expected: expect?.expectedKind ?? null,
      rawScore: output ? (output.probabilities.chat ?? null) : null,
      probabilities: output?.probabilities ?? null,
    };
  },
  mainQuestionBindings(req, canonicalExpected) {
    return req.questions.kind === undefined ? [] : [{ question: "kind", expected: canonicalExpected }];
  },
  oracleAnswer(key, q: ChoiceQ | NoulQ, expect) {
    if (q.type === "noul") return key === "multi" ? expect.expectedKind === "multi" : undefined;
    return expect.expectedKind;
  },
};
