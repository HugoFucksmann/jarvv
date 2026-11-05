/**
 * eval/core/graders/question.ts
 *
 * Graders para la etapa QUESTION (ask_user).
 */

import type { Grader, QuestionExpect, QuestionOutput } from "../types.ts";
import { containsTerm } from "./common.ts";

/**
 * Fugas de identificadores internos: ids de producción (c1, s2, r3), nombres de herramientas
 * conocidos y cualquier identificador snake_case (read_file, write_file, start_process, ...).
 */
const INTERNAL_LEAK_RE = /\b(?:[a-z]+_[a-z0-9_]+|[csr]\d+|desktop_commander)\b/;

/**
 * Nombres de archivo o ruta (`mi_archivo.txt`, `C:\\a\\b_c.ts`): no son identificadores internos, así que se
 * quitan antes de buscar fugas. Los ids de producción son minúsculas (c1, s2, r3): "S3" o "C1" no cuentan.
 */
const FILE_LIKE_RE = /[\w./\\:~-]+\.[A-Za-z0-9]{1,5}\b/g;

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
        `Longitud de la pregunta (${q.length}) supera el máximo (${expect.maxChars}).`,
      );
    }

    if (expect.singleQuestionOnly) {
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

    // Regla de producción: no debe filtrar nombres de herramientas internas ni identificadores (c1, s2, r3, MCPs)
    const leaks = q.replace(FILE_LIKE_RE, " ").match(INTERNAL_LEAK_RE);
    col.check(
      "no_internal_leaks",
      !leaks,
      `La pregunta filtra identificadores o herramientas internas: '${leaks?.[0]}'`,
    );

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
