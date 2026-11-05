/**
 * eval/prompts/core/questions.ts
 *
 * Decisiones con varias preguntas en un mismo request. Un request de decisión puede llevar más de una
 * pregunta (las del caso más las que agrega una variante). Este módulo:
 *
 *  1. parsea cada pregunta por separado: una respuesta mal formada afecta solo a su pregunta;
 *  2. arma un `QuestionResult` por clave, con la respuesta, la esperada y si acertó;
 *  3. evalúa las preguntas adicionales contra `expect.answers`, con checks propios (`q_<clave>_…`).
 *
 * La pregunta principal (la que alimenta la salida canónica de la etapa) sigue evaluándose con los graders de la
 * etapa; acá solo se registra, para poder cruzarla con las demás.
 */

import { NOUL_APPROVE } from "./contract.ts";
import type {
  AnswerExpects,
  ChoiceQ,
  DecisionRequest,
  DecisionStage,
  GraderCollector,
  QuestionResult,
  ResultVerificationExpect,
} from "./types.ts";
import type { DecisionStageVariant } from "./variants/types.ts";
import { applyLabelMap, choiceQuestionKey, DEFAULT_ANSWER_MAP, parseAnswers } from "./variants/labels.ts";
import type { ParsedAnswer } from "./variants/labels.ts";

const YES = "yes";
const NO = "no";

/** Pregunta que alimenta la salida de la etapa, y qué espera el caso de ella (null = no se puede fijar). */
interface MainBinding {
  question: string;
  expected: string | null;
}

/**
 * Preguntas principales de la etapa según el `answerMap` de la variante (o el default de producción).
 * `canonicalExpected` es la etiqueta canónica esperada de las etapas de una sola pregunta.
 */
function mainBindings(
  stage: DecisionStage,
  sv: DecisionStageVariant | undefined,
  req: DecisionRequest,
  canonicalExpected: string | null,
  expect: Record<string, unknown>,
): MainBinding[] {
  const answerMap = sv?.answerMap ?? DEFAULT_ANSWER_MAP[stage];
  if (stage !== "result_verification") {
    try {
      return [{ question: choiceQuestionKey(answerMap), expected: canonicalExpected }];
    } catch {
      return [];
    }
  }
  const rv = expect as unknown as ResultVerificationExpect;
  const out: MainBinding[] = [];
  for (const [field, want] of [["ok", rv.expectedOk], ["cumple", rv.expectedCumple]] as const) {
    const m = answerMap[field];
    if (!m) continue;
    if (typeof m === "string") {
      out.push({ question: m, expected: want === undefined ? null : want ? YES : NO });
    } else {
      // Booleano derivado de una pregunta `choice`: solo se puede fijar la opción "verdadera".
      out.push({ question: m.question, expected: want ? m.trueOption : null });
    }
  }
  // Una pregunta sin entrada en el request no se registra como principal.
  return out.filter((b) => req.questions[b.question] !== undefined);
}

function readChoice(
  a: ParsedAnswer | undefined,
  q: ChoiceQ,
): { answer: string; probabilities: Record<string, number> } | string {
  if (!a || typeof a !== "object") return "la respuesta no incluye esta pregunta";
  if (typeof a.choice !== "string" || !Object.prototype.hasOwnProperty.call(q.criteria, a.choice)) {
    return `choice_not_in_criteria: '${String(a.choice)}'`;
  }
  const probabilities: Record<string, number> = {};
  if (a.probabilities && typeof a.probabilities === "object") {
    for (const [k, v] of Object.entries(a.probabilities)) {
      if (typeof v === "number" && Number.isFinite(v)) probabilities[k] = v;
    }
  }
  return { answer: a.choice, probabilities };
}

function readNoul(a: ParsedAnswer | undefined): number | string {
  if (!a || typeof a !== "object") return "la respuesta no incluye esta pregunta";
  if (typeof a.noul !== "number" || !Number.isFinite(a.noul) || a.noul < 0 || a.noul > 1) {
    return "noul debe ser un número en [0,1]";
  }
  return a.noul;
}

function explicitExpected(a: AnswerExpects[string] | undefined, type: "choice" | "noul"): string | null {
  if (!a) return null;
  if (type === "choice") return typeof a.choice === "string" ? a.choice : null;
  return typeof a.yes === "boolean" ? (a.yes ? YES : NO) : null;
}

export interface BuildQuestionsInput {
  rawOutput: string;
  /** Request ya con la variante aplicada: define qué preguntas se enviaron. */
  sentReq: DecisionRequest;
  stage: DecisionStage;
  sv: DecisionStageVariant | undefined;
  /** `expect` del caso. */
  expect: Record<string, unknown>;
  /** Etiqueta canónica esperada de la etapa (de `entry.label`). */
  canonicalExpected: string | null;
}

/** Un `QuestionResult` por cada pregunta enviada. Nunca lanza: los errores quedan en la pregunta afectada. */
export function buildQuestionResults(input: BuildQuestionsInput): Record<string, QuestionResult> {
  const { rawOutput, sentReq, stage, sv, expect, canonicalExpected } = input;
  const out: Record<string, QuestionResult> = {};

  let answers: Record<string, ParsedAnswer> | undefined;
  let globalError: string | undefined;
  try {
    answers = parseAnswers(rawOutput);
  } catch (e) {
    globalError = e instanceof Error ? e.message : String(e);
  }

  const bindings = mainBindings(stage, sv, sentReq, canonicalExpected, expect);
  const explicit = (expect.answers ?? {}) as AnswerExpects;

  for (const [key, q] of Object.entries(sentReq.questions)) {
    const binding = bindings.find((b) => b.question === key);
    const role: "main" | "extra" = binding ? "main" : "extra";
    // La principal se espera según la etapa; una extra, según `expect.answers`.
    const expected = binding ? binding.expected : explicitExpected(explicit[key], q.type);

    const res: QuestionResult = { type: q.type, role, answer: null, expected, correct: null };
    const raw = answers?.[key];

    if (globalError !== undefined) {
      res.error = globalError;
    } else if (q.type === "choice") {
      const r = readChoice(raw, q);
      if (typeof r === "string") {
        res.error = r;
      } else {
        // `labelMap` solo aplica a la pregunta principal: sus opciones son las que la variante renombra.
        const mapped = binding ? applyLabelMap(r.answer, r.probabilities, sv?.labelMap) : undefined;
        res.answer = mapped ? mapped.choice : r.answer;
        res.probabilities = mapped ? mapped.probabilities : r.probabilities;
        if (res.answer !== r.answer) res.rawAnswer = r.answer;
      }
    } else {
      const r = readNoul(raw);
      if (typeof r === "string") {
        res.error = r;
      } else {
        res.noul = r;
        res.answer = r > NOUL_APPROVE ? YES : NO;
      }
    }

    // Con expectativa, no responder es un error de la pregunta (no se descarta del denominador).
    if (expected !== null) res.correct = res.answer === expected;
    out[key] = res;
  }
  return out;
}

/**
 * Evalúa las preguntas adicionales contra `expect.answers`. Un check por pregunta (`q_<clave>_match`), de modo que
 * cada una falla y se reporta por separado. La principal no se evalúa acá (la cubren los graders de la etapa).
 */
export function gradeExtraQuestions(
  results: Record<string, QuestionResult>,
  expectAnswers: AnswerExpects | undefined,
  col: GraderCollector,
): void {
  for (const [key, want] of Object.entries(expectAnswers ?? {})) {
    const r = results[key];
    if (!r) {
      // La pregunta no viajó en este request (p. ej. la agrega otra variante): no hay nada que medir.
      col.soft(
        `q_${key}_sent`,
        false,
        `Se esperaba respuesta para la pregunta '${key}' pero el request no la incluye; no se evaluó.`,
      );
      continue;
    }
    if (r.role === "main") continue; // ya evaluada por la etapa

    const target = r.expected ?? "(sin expectativa)";
    if (r.answer === null) {
      col.check(
        `q_${key}_match`,
        false,
        `Pregunta '${key}': sin respuesta válida (${r.error ?? "desconocido"}); se esperaba '${target}'.`,
      );
      continue;
    }
    col.check(
      `q_${key}_match`,
      r.answer === r.expected,
      `Pregunta '${key}': respuesta '${r.answer}' difiere de la esperada '${target}'.`,
    );

    if (want.minProbability !== undefined) {
      const prob = r.type === "noul" ? r.noul : r.probabilities?.[r.expected ?? ""];
      if (prob === undefined || !Number.isFinite(prob)) {
        col.check(
          `q_${key}_min_probability`,
          false,
          `Pregunta '${key}': se pidió probabilidad mínima ${want.minProbability} pero la salida no la trae.`,
        );
      } else {
        col.check(
          `q_${key}_min_probability`,
          prob >= want.minProbability,
          `Pregunta '${key}': probabilidad ${prob.toFixed(3)} menor al mínimo ${want.minProbability}.`,
        );
      }
    }
  }
}
