/**
 * eval/core/stages/question.ts
 *
 * Etapa generativa `question`: pregunta al usuario cuando falta información.
 */

import { askRenderOptions, questionStageRequest, renderAsk, stripThink } from "../contract.ts";
import { LatencyGrader, TruncationNoteGrader } from "../graders/common.ts";
import { QuestionGrader } from "../graders/question.ts";
import type { QuestionExpect, QuestionOutput } from "../types.ts";
import { checkIntMin1, noLabel } from "./shared.ts";
import type { GenerativeStageEntry } from "./types.ts";

export const questionStage: GenerativeStageEntry<QuestionOutput, QuestionExpect> = {
  stageName: "question",
  requestType: "generative",
  rejectTruncated: false,
  expectSpec: {
    keys: { maxChars: "number", mustContainKeywords: "string[]", forbiddenKeywords: "string[]", singleQuestionOnly: "boolean" },
    atLeastOne: ["maxChars", "mustContainKeywords", "forbiddenKeywords", "singleQuestionOnly"],
    validate(expectObj, errs) {
      checkIntMin1(expectObj, ["maxChars"], errs);
      // Que sea una sola pregunta y no filtre términos internos se mide siempre; lo que decide si pregunta lo correcto es lo que pide.
      if (expectObj.mustContainKeywords === undefined) errs.push("expect.mustContainKeywords es obligatorio: sin él no se mide que la pregunta pida lo que falta.");
    },
  },
  graders: [LatencyGrader, TruncationNoteGrader, QuestionGrader],
  buildRequest(sc, ov, h) {
    const { ctx } = h.buildContext(sc);
    return {
      request: h.generative(questionStageRequest({ view: renderAsk(ctx.view.forAsk(), askRenderOptions()) }, h.effectivePrompts(ov).P)),
    };
  },
  parseOutput(rawOutput: string): QuestionOutput {
    const question = stripThink(rawOutput).trim();
    if (!question) throw new Error("salida vacía");
    return { question };
  },
  label: noLabel,
  oracleOutput(_prepared, _ctx, expect, h) {
    const kws = h.firstAlt(h.strs(expect.mustContainKeywords));
    const forbidden = h.allAlts(h.strs(expect.forbiddenKeywords)).map(h.fold).filter((w) => w.length > 0);
    const max = h.num(expect.maxChars);
    const candidates =
      kws.length > 0
        ? [`¿Podrías indicarme ${kws.join(" ")}?`, `¿${kws.join(" ")}?`]
        : [
          "¿Cuál es el nombre del archivo?",
          "¿Qué nombre debo usar?",
          "¿Dónde lo guardo?",
          "¿Puedes darme más detalles?",
          "¿Podrías aclararme eso?",
          // Casos con pedido en inglés: prohíben las palabras en español.
          "Could you give me more details?",
          "Which one do you mean?",
        ];
    const valid = (t: string) => !forbidden.some((w) => h.fold(t).includes(w)) && (max === undefined || t.length <= max);
    const text = candidates.find(valid) ?? candidates[0];
    return max !== undefined && text.length > max ? `${text.slice(0, Math.max(1, max - 1))}?` : text;
  },
};
