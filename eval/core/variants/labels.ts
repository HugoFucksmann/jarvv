/**
 * eval/core/variants/labels.ts
 *
 * Parser de decisión: produce la salida canónica (*Output de 5.2) desde la respuesta cruda. Con las preguntas de producción
 * usa la lectura de producción; una variante que cambia las preguntas aporta `read` (ver `DecisionReaders`).
 *
 * Implementa `Decision20Engine.parseResponse` y los mapeos de `chooseRoute`,
 * `chooseTool`, `reviewArgs`, `runVerification`.
 */

import {
  ARGS_REVIEWS,
  EXECUTABLE_ROUTES,
  isExecutableRoute,
  NOUL_APPROVE,
  parseAnswersObject,
  reviewOutcome,
  validateAnswer,
} from "../contract.ts";
import type {
  ArgsReviewOutput,
  ChoiceQ,
  DecisionRequest,
  ResultVerificationOutput,
  RouteOutput,
  ToolChoiceOutput,
} from "../types.ts";
import type { DecisionReaders, ReadAnswer } from "../types.ts";

// ───────────────────────── Error de parseo ─────────────────────────

export class DecisionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionParseError";
  }
}

// ───────────────────────── Preguntas principales ─────────────────────────

/** Pregunta (o preguntas) de producción que alimentan la salida de cada etapa. */
export const MAIN_QUESTIONS: Record<string, readonly string[]> = {
  route: ["route"],
  tool_choice: ["selected_tool"],
  args_review: ["review"],
  result_verification: ["ok", "cumple"],
};

// ───────────────────────── Parseo de la respuesta cruda ─────────────────────────

export interface ParsedAnswer {
  choice?: string;
  probabilities?: Record<string, number>;
  noul?: number;
}

/** El objeto `answers` de la respuesta cruda. Valida con el mismo código que producción (`src/core/decision.ts`). */
export function parseAnswers(rawOutput: string): Record<string, ParsedAnswer> {
  try {
    return parseAnswersObject(rawOutput) as Record<string, ParsedAnswer>;
  } catch (e) {
    throw new DecisionParseError(e instanceof Error ? e.message : String(e));
  }
}

/** Extrae el valor de una pregunta `choice` de los answers. Lanza si falta o no está en criteria. */
function extractChoice(
  answers: Record<string, ParsedAnswer>,
  questionKey: string,
  sentCriteria: Record<string, string>,
): { choice: string; probabilities: Record<string, number> } {
  try {
    const a = validateAnswer(questionKey, { type: "choice", instructions: "", criteria: sentCriteria }, answers[questionKey]);
    if (!("choice" in a)) throw new Error(`La respuesta de '${questionKey}' no es de tipo choice.`);
    return { choice: a.choice, probabilities: a.probabilities };
  } catch (e) {
    throw new DecisionParseError(e instanceof Error ? e.message : String(e));
  }
}

/** Extrae el valor de una pregunta `noul`. Lanza si falta o está fuera de rango. */
function extractNoul(answers: Record<string, ParsedAnswer>, questionKey: string): number {
  try {
    const a = validateAnswer(questionKey, { type: "noul", instructions: "" }, answers[questionKey]);
    if (!("noul" in a)) throw new Error(`La respuesta de '${questionKey}' no es de tipo noul.`);
    return a.noul;
  } catch (e) {
    throw new DecisionParseError(e instanceof Error ? e.message : String(e));
  }
}

// ───────────────────────── Parsers por etapa ─────────────────────────

/** Valida la pregunta `choice` principal de la etapa y devuelve su elección y probabilidades. */
function mainChoice(stage: string, rawOutput: string, sentReq: DecisionRequest): { choice: string; probabilities: Record<string, number> } {
  const answers = parseAnswers(rawOutput);
  const questionKey = MAIN_QUESTIONS[stage][0];
  const q = sentReq.questions[questionKey];
  if (!q || q.type !== "choice") {
    throw new DecisionParseError(`La pregunta '${questionKey}' de la etapa '${stage}' no es choice o no existe.`);
  }
  return extractChoice(answers, questionKey, (q as ChoiceQ).criteria);
}

/** Parsea la respuesta y produce `RouteOutput`. Implementa la lógica de `chooseRoute`. */
export function parseRouteDecision(rawOutput: string, sentReq: DecisionRequest): RouteOutput {
  const { choice, probabilities } = mainChoice("route", rawOutput, sentReq);
  // Validación canónica (7.6 §7)
  if (isExecutableRoute(choice)) return { route: choice, probabilities };
  throw new DecisionParseError(`La ruta '${choice}' no es válida (${EXECUTABLE_ROUTES.join("|")}).`);
}

/** Parsea la respuesta y produce `ToolChoiceOutput`. Implementa la lógica de `chooseTool`. */
export function parseToolChoiceDecision(rawOutput: string, sentReq: DecisionRequest): ToolChoiceOutput {
  const { choice, probabilities } = mainChoice("tool_choice", rawOutput, sentReq);
  return { selected: choice, probabilities };
}

/**
 * Parsea la respuesta y produce `ArgsReviewOutput`. Implementa la lógica de `reviewArgs`. Con `read` (la variante cambió las
 * preguntas), todas las preguntas `noul` enviadas se cruzan con esa función; sin él, se lee la pregunta `review` de producción.
 */
export function parseArgsReviewDecision(rawOutput: string, sentReq: DecisionRequest, read?: DecisionReaders["args_review"]): ArgsReviewOutput {
  let result: { choice: string; probabilities: Record<string, number> };
  if (read) {
    const answers = parseAnswers(rawOutput);
    const values: Record<string, number> = {};
    for (const [key, q] of Object.entries(sentReq.questions)) {
      if (q.type === "noul") values[key] = extractNoul(answers, key);
    }
    result = read(values);
  } else {
    result = mainChoice("args_review", rawOutput, sentReq);
  }
  if (!(ARGS_REVIEWS as readonly string[]).includes(result.choice)) {
    throw new DecisionParseError(`'${result.choice}' no es un valor válido de revisión (${ARGS_REVIEWS.join("|")}).`);
  }
  // Como producción (`callRunner`): aprueba solo si P(approved) llega al umbral; si no, la rechazo más probable.
  const review = reviewOutcome({ review: result.choice as (typeof ARGS_REVIEWS)[number], probabilities: result.probabilities });
  return { review, probabilities: result.probabilities };
}

/**
 * Parsea la respuesta y produce `ResultVerificationOutput`. Implementa la lógica de `runVerification`. Con `read`, todas las
 * preguntas enviadas (choice con sus probabilidades, noul con su valor) se cruzan con esa función; sin él, se leen las dos
 * preguntas `noul` de producción, `ok` y `cumple`.
 */
export function parseResultVerificationDecision(
  rawOutput: string,
  sentReq: DecisionRequest,
  read?: DecisionReaders["result_verification"],
): ResultVerificationOutput {
  const answers = parseAnswers(rawOutput);
  let ok: number;
  let cumple: number;
  if (read) {
    const values: Record<string, ReadAnswer> = {};
    for (const [key, q] of Object.entries(sentReq.questions)) {
      values[key] = q.type === "noul" ? { noul: extractNoul(answers, key) } : { probabilities: extractChoice(answers, key, (q as ChoiceQ).criteria).probabilities };
    }
    ({ ok, cumple } = read(values));
  } else {
    ok = extractNoul(answers, "ok");
    cumple = extractNoul(answers, "cumple");
  }
  return { ok: ok >= NOUL_APPROVE, cumple: cumple >= NOUL_APPROVE, okProbability: ok, cumpleProbability: cumple };
}
