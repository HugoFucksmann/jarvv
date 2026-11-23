/**
 * eval/core/stages/result_verification.ts
 *
 * Etapa `result_verification` (Decisión 4): verificar si el resultado cumple el paso.
 */

import { knownVerifyAnswers, VERIFY_APPROVE, verifyInput } from "../contract.ts";
import { LatencyGrader } from "../graders/common.ts";
import { ResultVerificationGrader } from "../graders/label.ts";
import type { ChoiceQ, DecisionRequest, NoulQ, ResultVerificationExpect, ResultVerificationOutput } from "../types.ts";
import { extractNoul, parseAnswers } from "../variants/labels.ts";
import { checkRange01, NO, YES } from "./shared.ts";
import type { DecisionStageEntry } from "./types.ts";

export const resultVerificationStage: DecisionStageEntry<ResultVerificationOutput, ResultVerificationExpect> = {
  stageName: "result_verification",
  requestType: "decision",
  expectSpec: {
    keys: { expectedOk: "boolean", expectedCumple: "boolean", minOkProb: "number", minCumpleProb: "number", answers: "object" },
    required: ["expectedOk", "expectedCumple"],
    validate(expectObj, errs) {
      checkRange01(expectObj, ["minOkProb", "minCumpleProb"], errs);
      // Para `noul` la probabilidad es la de "sí": un mínimo solo tiene sentido si lo esperado es true.
      if (expectObj.minOkProb !== undefined && expectObj.expectedOk === false) {
        errs.push("expect.minOkProb contradice expectedOk=false (la probabilidad medida es la de 'sí').");
      }
      if (expectObj.minCumpleProb !== undefined && expectObj.expectedCumple === false) {
        errs.push("expect.minCumpleProb contradice expectedCumple=false (la probabilidad medida es la de 'sí').");
      }
    },
  },
  graders: [LatencyGrader, ResultVerificationGrader],
  buildRequest(sc, ov, h) {
    const { ctx, callIds } = h.buildContext(sc);
    const at = sc.at ?? {};
    const id = callIds[at.call ?? callIds.length - 1];
    if (id === undefined) throw new Error("etapa 'result_verification': el escenario no tiene la llamada a evaluar (scenario.calls / at.call).");
    const input = verifyInput(ctx.view.forVerify(id));
    // Como producción (`verifyCall`): lo que el código ya responde (`knownVerifyAnswers`) no se le pregunta al modelo.
    const evaluated = ctx.find("calls", { id })[0];
    const known = evaluated === undefined ? undefined : knownVerifyAnswers(evaluated.tool, evaluated.status, evaluated.summary);
    // En reactivo el contexto exige `expected: null` en el paso (validate.ts): el `expected` del escenario se inyecta aquí, solo en eval.
    const steps = sc.steps ?? [];
    const ci = at.call ?? callIds.length - 1;
    const si = sc.calls?.[ci]?.step ?? steps.length - 1;
    const expected = steps[Math.min(Math.max(si, 0), steps.length - 1)]?.expected ?? null;
    return h.decision(
      h.effectivePrompts(ov).D.buildResultVerification({
        ...input,
        ...(known === undefined || Object.keys(known).length === 0 ? {} : { known }),
        criterion: expected === null ? input.criterion : { ...input.criterion, expected },
        request: at.lastItem ? sc.request : null,
      }),
    );
  },
  validateRequest(req) {
    if (req.questions.cumple?.type !== "noul") {
      return "result_verification requiere pregunta noul 'cumple'.";
    }
    if (req.questions.ok !== undefined && req.questions.ok.type !== "noul") {
      return "la pregunta 'ok' debe ser type: 'noul'.";
    }
    return null;
  },
  parseOutput(rawOutput: string, sentReq: DecisionRequest): ResultVerificationOutput {
    const answers = parseAnswers(rawOutput);
    // Producción responde `ok` por código en lecturas deterministas con contenido (`known`): la pregunta no se envía y vale 1.
    const ok = sentReq.questions.ok === undefined ? 1 : extractNoul(answers, "ok");
    const cumple = extractNoul(answers, "cumple");
    return { ok: ok >= VERIFY_APPROVE.ok, cumple: cumple >= VERIFY_APPROVE.cumple, okProbability: ok, cumpleProbability: cumple };
  },
  label(output, expect) {
    const predicted = output ? `ok=${output.ok},cumple=${output.cumple}` : null;
    const expected = expect ? `ok=${expect.expectedOk},cumple=${expect.expectedCumple}` : null;
    return {
      predicted,
      expected,
      rawScore: output?.okProbability ?? null,
      probabilities: output ? { ok: output.okProbability, cumple: output.cumpleProbability } : null,
    };
  },
  mainQuestionBindings(req, _canonicalExpected, expect) {
    const wants = [expect.expectedOk, expect.expectedCumple];
    return ["ok", "cumple"]
      .map((question, i) => ({ question, expected: wants[i] === undefined ? null : wants[i] ? YES : NO }))
      .filter((b) => req.questions[b.question] !== undefined);
  },
  oracleAnswer(key, q: ChoiceQ | NoulQ, expect) {
    if (q.type !== "noul") return undefined;
    if (key === "ok") return expect.expectedOk;
    if (key === "cumple") return expect.expectedCumple;
    return undefined;
  },
};
