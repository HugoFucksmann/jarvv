/**
 * eval/core/questions.ts
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

import { NOUL_APPROVE, validateAnswer } from "./contract.ts";
import type {
  AnswerExpects,
  ChoiceQ,
  DecisionRequest,
  DecisionStage,
  FragmentJudgeExpect,
  GraderCollector,
  QuestionResult,
  ResultVerificationExpect,
} from "./types.ts";
import { fragmentKeys, MAIN_QUESTIONS, parseAnswers } from "./variants/labels.ts";
import type { ParsedAnswer } from "./variants/labels.ts";

const YES = "yes";
const NO = "no";

/** Pregunta que alimenta la salida de la etapa, y qué espera el caso de ella (null = no se puede fijar). */
interface MainBinding {
  question: string;
  expected: string | null;
}

/**
 * Preguntas principales de la etapa: las de producción (`MAIN_QUESTIONS`). Una que el request no trae (la variante cambió las
 * preguntas) no se registra como principal. `canonicalExpected` es la etiqueta canónica esperada de las etapas de una sola pregunta.
 */
function mainBindings(
  stage: DecisionStage,
  req: DecisionRequest,
  canonicalExpected: string | null,
  expect: Record<string, unknown>,
): MainBinding[] {
  const keys = MAIN_QUESTIONS[stage];
  let out: MainBinding[];
  if (stage === "fragment_judge") {
    // Si f<i> es choice (variantes con ranking/clasificación), f<i> es extra o no se mapea a YES/NO salvo que sea noul.
    const wants = (expect as unknown as FragmentJudgeExpect).expectedRelevant ?? [];
    return fragmentKeys(req)
      .filter((k) => req.questions[k]?.type === "noul")
      .map((question, i) => ({ question, expected: wants[i] === undefined ? null : wants[i] ? YES : NO }));
  }
  if (stage === "result_verification") {
    const rv = expect as unknown as ResultVerificationExpect;
    const wants = [rv.expectedOk, rv.expectedCumple];
    out = keys.map((question, i) => ({ question, expected: wants[i] === undefined ? null : wants[i] ? YES : NO }));
  } else {
    out = [{ question: keys[0], expected: canonicalExpected }];
  }
  return out.filter((b) => req.questions[b.question] !== undefined);
}

/** Valida una pregunta `choice` con el código de producción; devuelve el motivo si la respuesta no sirve. */
function readChoice(
  key: string,
  a: unknown,
  q: ChoiceQ,
): { answer: string; probabilities: Record<string, number> } | string {
  try {
    const v = validateAnswer(key, q, a);
    return "choice" in v ? { answer: v.choice, probabilities: v.probabilities } : "la respuesta no es de tipo choice";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Valida una pregunta `noul` con el código de producción; devuelve el motivo si la respuesta no sirve. */
function readNoul(key: string, a: unknown): number | string {
  try {
    const v = validateAnswer(key, { type: "noul", instructions: "" }, a);
    return "noul" in v ? v.noul : "la respuesta no es de tipo noul";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function explicitExpected(a: AnswerExpects[string] | undefined, type: "choice" | "noul"): string | null {
  if (!a) return null;
  if (type === "choice") return typeof a.choice === "string" ? a.choice : null;
  return typeof a.yes === "boolean" ? (a.yes ? YES : NO) : null;
}

export interface BuildQuestionsInput {
  rawOutput: string;
  /** Request ya armado con los prompts de la variante: define qué preguntas se enviaron. */
  sentReq: DecisionRequest;
  stage: DecisionStage;
  /** `expect` del caso. */
  expect: Record<string, unknown>;
  /** Etiqueta canónica esperada de la etapa (de `entry.label`). */
  canonicalExpected: string | null;
}

/** Un `QuestionResult` por cada pregunta enviada. Nunca lanza: los errores quedan en la pregunta afectada. */
export function buildQuestionResults(input: BuildQuestionsInput): Record<string, QuestionResult> {
  const { rawOutput, sentReq, stage, expect, canonicalExpected } = input;
  const out: Record<string, QuestionResult> = {};

  let answers: Record<string, ParsedAnswer> | undefined;
  let globalError: string | undefined;
  try {
    answers = parseAnswers(rawOutput);
  } catch (e) {
    globalError = e instanceof Error ? e.message : String(e);
  }

  const bindings = mainBindings(stage, sentReq, canonicalExpected, expect);
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
      const r = readChoice(key, raw, q);
      if (typeof r === "string") {
        res.error = r;
      } else {
        res.answer = r.answer;
        res.probabilities = r.probabilities;
      }
    } else {
      const r = readNoul(key, raw);
      if (typeof r === "string") {
        res.error = r;
      } else {
        res.noul = r;
        res.answer = r >= NOUL_APPROVE ? YES : NO;
      }
    }

    // Con expectativa, no responder es un error de la pregunta (no se descarta del denominador).
    if (expected !== null) res.correct = res.answer === expected;
    out[key] = res;
  }
  return out;
}

/**
 * Evalúa las preguntas adicionales contra `expect.answers`. Un check por pregunta (`q_<clave>_match`, y `q_<clave>_min_probability` si trae `minProbability`), de modo que
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
