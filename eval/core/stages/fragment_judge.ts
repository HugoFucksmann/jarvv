/**
 * eval/core/stages/fragment_judge.ts
 *
 * Etapa `fragment_judge`: juez de relevancia de fragmentos de búsqueda web.
 */

import { isRecord, JUDGE_BATCH, JUDGE_FOUND } from "../contract.ts";
import { LatencyGrader } from "../graders/common.ts";
import { FragmentJudgeGrader } from "../graders/label.ts";
import type { ChoiceQ, DecisionRequest, FragmentJudgeExpect, FragmentJudgeOutput, NoulQ } from "../types.ts";
import { DecisionParseError, extractNoul, fragmentKeys, parseAnswers } from "../variants/labels.ts";
import { checkRange01, NO, YES } from "./shared.ts";
import type { DecisionStageEntry } from "./types.ts";

const judgeLabel = (flags: readonly boolean[]): string => flags.map((v, i) => `f${i}=${v}`).join(",");

export const fragmentJudgeStage: DecisionStageEntry<FragmentJudgeOutput, FragmentJudgeExpect> = {
  stageName: "fragment_judge",
  requestType: "decision",
  expectSpec: {
    keys: { expectedRelevant: "boolean[]", minProbability: "number", answers: "object" },
    required: ["expectedRelevant"],
    validate(expectObj, errs, request) {
      checkRange01(expectObj, ["minProbability"], errs);
      if (Array.isArray(expectObj.expectedRelevant) && isRecord(request) && isRecord(request.questions)) {
        const n = fragmentKeys(request as unknown as DecisionRequest).length;
        if (expectObj.expectedRelevant.length !== n) {
          errs.push(`expect.expectedRelevant tiene ${expectObj.expectedRelevant.length} valores y el request trae ${n} fragmentos.`);
        }
      }
    },
  },
  graders: [LatencyGrader, FragmentJudgeGrader],
  buildRequest(sc, ov, h) {
    // No hay tarea ni contexto: el juez recibe solo la necesidad y los fragmentos (como `Decision20Engine.score`).
    const at = sc.at ?? {};
    const fragments = at.fragments ?? [];
    if (fragments.length === 0 || fragments.length > JUDGE_BATCH) {
      throw new Error(`etapa 'fragment_judge': at.fragments debe traer entre 1 y ${JUDGE_BATCH} fragmentos.`);
    }
    return h.decision(h.effectivePrompts(ov).D.buildFragmentJudge({ need: h.need(at.need, "need", "fragment_judge"), fragments }));
  },
  validateRequest(req, fc) {
    const fKeys = fragmentKeys(req);
    if (fKeys.length === 0 || fKeys.some((k) => req.questions[k]?.type !== "noul")) {
      return "fragment_judge requiere preguntas noul f0, f1...";
    }
    const expectedRelevant = (fc.expect as { expectedRelevant?: unknown }).expectedRelevant;
    if (Array.isArray(expectedRelevant)) {
      if (fKeys.length !== expectedRelevant.length) {
        return `fragment_judge generó ${fKeys.length} preguntas y el caso tiene ${expectedRelevant.length} fragmentos.`;
      }
      for (let fi = 0; fi < expectedRelevant.length; fi++) {
        if (!req.questions[`f${fi}`] || req.questions[`f${fi}`].type !== "noul") {
          return `falta la pregunta noul 'f${fi}'.`;
        }
      }
    }
    return null;
  },
  parseOutput(rawOutput: string, sentReq: DecisionRequest): FragmentJudgeOutput {
    const answers = parseAnswers(rawOutput);
    const keys = fragmentKeys(sentReq);
    if (keys.length === 0) throw new DecisionParseError("El request no trae preguntas de fragmento (f0, f1…).");

    const probabilities = keys.map((k) => extractNoul(answers, k));
    return { probabilities, relevant: probabilities.map((p) => p >= JUDGE_FOUND) };
  },
  label(output, expect) {
    return {
      predicted: output ? judgeLabel(output.relevant) : null,
      expected: expect ? judgeLabel(expect.expectedRelevant) : null,
      rawScore: output?.probabilities[0] ?? null,
      probabilities: output ? Object.fromEntries(output.probabilities.map((p, i) => [`f${i}`, p])) : null,
    };
  },
  mainQuestionBindings(req, _canonicalExpected, expect) {
    // Si f<i> es choice (variantes con ranking/clasificación), f<i> es extra o no se mapea a YES/NO salvo que sea noul.
    const wants = expect.expectedRelevant ?? [];
    return fragmentKeys(req)
      .filter((k) => req.questions[k]?.type === "noul")
      .map((question, i) => ({ question, expected: wants[i] === undefined ? null : wants[i] ? YES : NO }));
  },
  oracleAnswer(key, q: ChoiceQ | NoulQ, expect) {
    if (q.type !== "noul") return undefined;
    const frag = /^f(\d+)$/.exec(key);
    if (!frag || !Array.isArray(expect.expectedRelevant)) return undefined;
    return expect.expectedRelevant[Number(frag[1])];
  },
};
