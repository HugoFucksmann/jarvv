/**
 * eval/core/stages/d5.ts
 *
 * Etapa `d5` (Decisión 5): cierre de tarea reactiva con la lista de pendientes vacía.
 * Evalúa `DECISION_PROMPTS.buildCompletionCheck(completionInput(ctx))` con umbral `COMPLETION_APPROVE` (0.75).
 */

import { completionInput } from "../../../src/core/engine/adapters.ts";
import { COMPLETION_APPROVE, COMPLETION_KEY } from "../contract.ts";
import { LatencyGrader } from "../graders/common.ts";
import { D5LabelGrader } from "../graders/label.ts";
import type { ChoiceQ, D5Expect, D5Output, NoulQ } from "../types.ts";
import { extractNoul, parseAnswers } from "../variants/labels.ts";
import type { DecisionStageEntry } from "./index.ts";
import { checkRange01, NO, YES } from "./shared.ts";

export const d5Stage: DecisionStageEntry<D5Output, D5Expect> = {
  stageName: "d5",
  requestType: "decision",
  expectSpec: {
    keys: { expectedComplete: "boolean", minProbability: "number", maxProbability: "number", answers: "object" },
    required: ["expectedComplete"],
    validate(expectObj, errs) {
      checkRange01(expectObj, ["minProbability", "maxProbability"], errs);
      if (expectObj.minProbability !== undefined && expectObj.expectedComplete === false) {
        errs.push("expect.minProbability contradice expectedComplete=false (la probabilidad medida es la de 'sí').");
      }
      if (expectObj.maxProbability !== undefined && expectObj.expectedComplete === true) {
        errs.push("expect.maxProbability contradice expectedComplete=true (la probabilidad medida es la de 'sí').");
      }
    },
  },
  graders: [LatencyGrader, D5LabelGrader],
  buildRequest(sc, ov, h) {
    if (sc.mode !== "reactive") {
      throw new Error("etapa 'd5': el cierre por Decisión 5 solo existe en modo reactivo.");
    }
    const { ctx } = h.buildContext(sc);
    if (ctx.canFinish() !== "completed") {
      throw new Error("etapa 'd5': el escenario no puede cerrar por Decisión 5 (requiere al menos una llamada aprobada o calls vacío).");
    }
    return h.decision(h.effectivePrompts(ov).D.buildCompletionCheck(completionInput(ctx)));
  },
  parseOutput(rawOutput: string): D5Output {
    const answers = parseAnswers(rawOutput);
    const probability = extractNoul(answers, COMPLETION_KEY);
    return { complete: probability >= COMPLETION_APPROVE, probability };
  },
  label(output, expect) {
    return {
      predicted: output ? (output.complete ? YES : NO) : null,
      expected: expect ? (expect.expectedComplete ? YES : NO) : null,
      rawScore: output?.probability ?? null,
      probabilities: output ? { [COMPLETION_KEY]: output.probability } : null,
    };
  },
  mainQuestionBindings(req, canonicalExpected) {
    return req.questions[COMPLETION_KEY] === undefined ? [] : [{ question: COMPLETION_KEY, expected: canonicalExpected }];
  },
  oracleAnswer(key, q: ChoiceQ | NoulQ, expect) {
    if (q.type !== "noul" || key !== COMPLETION_KEY) return undefined;
    return expect.expectedComplete;
  },
};
