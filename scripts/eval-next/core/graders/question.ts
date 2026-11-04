/**
 * scripts/eval-next/core/graders/question.ts
 *
 * Graders para la etapa QUESTION (QUESTION de producción para ask_user).
 */

import type { Grader, QuestionExpect, QuestionOutput } from "../types.ts";

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const QuestionGrader: Grader<QuestionOutput, QuestionExpect> = {
  name: "question",
  grade(output, expect, _ctx, col) {
    if (!output || !output.question || typeof output.question !== "string") {
      col.check("valid_question", false, "Salida no contiene un texto de pregunta válido.");
      return;
    }

    const q = output.question.trim();
    col.measure("question_chars", q.length);

    if (expect.maxChars !== undefined) {
      col.check(
        "max_chars_met",
        q.length <= expect.maxChars,
        `Longitud de la pregunta (${q.length}) supera el máximo (${expect.maxChars}).`
      );
    }

    if (expect.singleQuestionOnly) {
      const qMarks = (q.match(/\?/g) || []).length;
      col.check(
        "single_question",
        qMarks <= 1,
        `La salida parece contener más de una pregunta (${qMarks} signos de interrogación).`
      );
    }

    // Regla de producción: no debe filtrar nombres de herramientas internas ni identificadores (c1, s2, r3, MCPs)
    const leaks = q.match(/\b(read_file|start_process|c\d+|s\d+|r\d+|desktop_commander)\b/i);
    col.check(
      "no_internal_leaks",
      !leaks,
      `La pregunta filtra identificadores o herramientas internas: '${leaks?.[0]}'`
    );

    const normed = norm(q);

    if (expect.mustContainKeywords && expect.mustContainKeywords.length > 0) {
      for (const kw of expect.mustContainKeywords) {
        col.check(
          `keyword_${kw}`,
          normed.includes(norm(kw)),
          `Pregunta no contiene la palabra clave esperada: '${kw}'`
        );
      }
    }

    if (expect.forbiddenKeywords && expect.forbiddenKeywords.length > 0) {
      for (const bad of expect.forbiddenKeywords) {
        col.check(
          `no_forbidden_${bad}`,
          !normed.includes(norm(bad)),
          `Pregunta contiene palabra prohibida: '${bad}'`
        );
      }
    }
  },
};

