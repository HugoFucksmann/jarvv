/**
 * eval/core/graders/question.ts
 *
 * Graders para la etapa QUESTION (la pregunta que se le hace al usuario).
 */

import type { Grader, QuestionExpect, QuestionOutput } from "../types.ts";
import { containsTerm, findInternalLeak } from "./common.ts";

export const QuestionGrader: Grader<QuestionOutput, QuestionExpect> = {
  name: "question",
  grade(output, expect, _ctx, col) {
    if (!output?.question || typeof output.question !== "string") {
      col.check("valid_question", false, "Salida no contiene un texto de pregunta válido.");
      return;
    }

    const q = output.question.trim();
    col.measure("question_chars", q.length);

    if (expect.maxChars !== undefined) {
      col.check(
        "max_chars_met",
        q.length <= expect.maxChars,
        `Longitud de la pregunta (${q.length}) supera el máximo (${expect.maxChars}).`,
      );
    }

    // El prompt pide UNA pregunta: vale en todos los casos salvo que el caso diga `singleQuestionOnly: false`.
    if (expect.singleQuestionOnly !== false) {
      // Exactamente una pregunta: "Dime el nombre del archivo" (0 signos) ya no pasa.
      const qMarks = (q.match(/\?/g) || []).length;
      col.check(
        "single_question",
        qMarks === 1,
        qMarks === 0
          ? "La salida no es una pregunta (no tiene signo de interrogación)."
          : `La salida parece contener más de una pregunta (${qMarks} signos de interrogación).`,
      );
    }

    // Regla de producción: no debe filtrar nombres de herramientas, estados internos ni ids (c1, s2, r3).
    const leak = findInternalLeak(q);
    col.check("no_internal_leaks", leak === undefined, `La pregunta filtra un término interno: '${leak}'`);

    (expect.mustContainKeywords ?? []).forEach((kw, i) => {
      col.check(
        `keyword_${i}`,
        containsTerm(q, kw),
        `Pregunta no contiene la palabra clave esperada: '${kw}'`,
      );
    });

    (expect.forbiddenKeywords ?? []).forEach((bad, i) => {
      col.check(
        `no_forbidden_${i}`,
        !containsTerm(q, bad),
        `Pregunta contiene palabra prohibida: '${bad}'`,
      );
    });
  },
};
