/**
 * eval/prompts/core/variants/labels.ts
 *
 * Parser de decisión post-variante: aplica `labelMap` y `answerMap` para producir
 * la salida canónica (*Output de 5.2). Secciones 7.6 y 5.3.
 *
 * Implementa `Decision20Engine.parseResponse` y los mapeos de `chooseRoute`,
 * `chooseTool`, `reviewArgs`, `runVerification`.
 */

import {
  ARGS_REVIEWS,
  ASK_USER,
  EXECUTABLE_ROUTES,
  FIN,
  isExecutableRoute,
  NOUL_APPROVE,
} from "../contract.ts";
import type {
  ArgsReviewOutput,
  ChoiceQ,
  DecisionRequest,
  ResultVerificationOutput,
  RouteOutput,
  ToolChoiceOutput,
} from "../types.ts";
import type { DecisionStageVariant } from "./types.ts";

// ───────────────────────── Error de parseo ─────────────────────────

export class DecisionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionParseError";
  }
}

// ───────────────────────── Defaults de answerMap (sección 5.3) ─────────────────────────

const DEFAULT_ANSWER_MAP: Record<string, Record<string, string | { question: string; trueOption: string }>> = {
  route: { choice: "route" },
  tool_choice: { choice: "selected_tool" },
  args_review: { choice: "review" },
  result_verification: { ok: "ok", cumple: "cumple" },
};

// ───────────────────────── Parseo de la respuesta cruda ─────────────────────────

interface ParsedAnswer {
  choice?: string;
  probabilities?: Record<string, number>;
  noul?: number;
}

function parseAnswers(rawOutput: string): Record<string, ParsedAnswer> {
  let data: unknown;
  try {
    data = JSON.parse(rawOutput);
  } catch {
    throw new DecisionParseError("La respuesta de decisión no es JSON válido.");
  }
  if (
    typeof data !== "object" ||
    data === null ||
    !("answers" in data) ||
    typeof (data as Record<string, unknown>).answers !== "object" ||
    (data as Record<string, unknown>).answers === null
  ) {
    throw new DecisionParseError("La respuesta de decisión no contiene 'answers' objeto.");
  }
  return (data as { answers: Record<string, ParsedAnswer> }).answers;
}

/** Extrae el valor de una pregunta `choice` de los answers. Lanza si falta o no está en criteria. */
function extractChoice(
  answers: Record<string, ParsedAnswer>,
  questionKey: string,
  sentCriteria: Record<string, string>,
): { choice: string; probabilities: Record<string, number> } {
  const a = answers[questionKey];
  if (!a || typeof a !== "object") {
    throw new DecisionParseError(`La respuesta no incluye la pregunta '${questionKey}'`);
  }
  // hasOwnProperty: `in` aceptaba "constructor" / "toString" por la cadena de prototipos.
  if (typeof a.choice !== "string" || !Object.prototype.hasOwnProperty.call(sentCriteria, a.choice)) {
    throw new DecisionParseError(
      `choice_not_in_criteria: '${String(a.choice)}' no es una opción válida en '${questionKey}'.`,
    );
  }
  const probs: Record<string, number> = {};
  if (a.probabilities && typeof a.probabilities === "object") {
    for (const [k, v] of Object.entries(a.probabilities)) {
      if (typeof v === "number" && Number.isFinite(v)) probs[k] = v;
    }
  }
  return { choice: a.choice, probabilities: probs };
}

/** Extrae el valor de una pregunta `noul`. Lanza si falta o está fuera de rango. */
function extractNoul(answers: Record<string, ParsedAnswer>, questionKey: string): number {
  const a = answers[questionKey];
  if (!a || typeof a !== "object") {
    throw new DecisionParseError(`La respuesta no incluye la pregunta '${questionKey}'`);
  }
  if (typeof a.noul !== "number" || !Number.isFinite(a.noul) || a.noul < 0 || a.noul > 1) {
    throw new DecisionParseError(`noul en '${questionKey}' debe ser un número en [0,1].`);
  }
  return a.noul;
}

/** Clave de la pregunta `choice` según el answerMap. Lanza DecisionParseError (no TypeError) si falta. */
function choiceQuestionKey(
  answerMap: Record<string, string | { question: string; trueOption: string }>,
): string {
  const m = answerMap.choice;
  if (typeof m === "string") return m;
  if (m && typeof m === "object" && typeof m.question === "string") return m.question;
  throw new DecisionParseError("answerMap no tiene una entrada válida para 'choice'.");
}

// ───────────────────────── Aplicación de labelMap ─────────────────────────

function applyLabelMap(
  choice: string,
  probs: Record<string, number>,
  labelMap: Record<string, string> | undefined,
): { choice: string; probabilities: Record<string, number> } {
  if (!labelMap || Object.keys(labelMap).length === 0) {
    return { choice, probabilities: probs };
  }
  // hasOwn: una clave como "constructor" (viene del modelo) no debe resolver por el prototipo.
  const map = (k: string): string => (Object.hasOwn(labelMap, k) ? labelMap[k] : k);
  const mappedChoice = map(choice);
  const mappedProbs: Record<string, number> = {};
  for (const [k, v] of Object.entries(probs)) {
    mappedProbs[map(k)] = v;
  }
  return { choice: mappedChoice, probabilities: mappedProbs };
}

// ───────────────────────── Parsers por etapa ─────────────────────────

/**
 * Parsea la respuesta y produce `RouteOutput`.
 * Implementa la lógica de `chooseRoute`.
 */
export function parseRouteDecision(
  rawOutput: string,
  sentReq: DecisionRequest,
  sv: DecisionStageVariant | undefined,
): RouteOutput {
  const answers = parseAnswers(rawOutput);
  const answerMap = sv?.answerMap ?? DEFAULT_ANSWER_MAP.route;
  const labelMap = sv?.labelMap;

  const questionKey = choiceQuestionKey(answerMap);

  const q = sentReq.questions[questionKey];
  if (!q || q.type !== "choice") {
    throw new DecisionParseError(`La pregunta '${questionKey}' de ruta no es choice o no existe.`);
  }
  const { choice: rawChoice, probabilities: rawProbs } = extractChoice(answers, questionKey, (q as ChoiceQ).criteria);
  const { choice, probabilities } = applyLabelMap(rawChoice, rawProbs, labelMap);

  // Validación canónica (7.6 §7)
  if (choice === FIN) return { action: "fin", probabilities };
  if (choice === ASK_USER) return { action: "ask_user", probabilities };
  if (isExecutableRoute(choice)) return { action: "route", route: choice, probabilities };
  throw new DecisionParseError(`La ruta '${choice}' no es válida (fin, ask_user o ${EXECUTABLE_ROUTES.join("|")}).`);
}

/**
 * Parsea la respuesta y produce `ToolChoiceOutput`.
 * Implementa la lógica de `chooseTool`.
 */
export function parseToolChoiceDecision(
  rawOutput: string,
  sentReq: DecisionRequest,
  sv: DecisionStageVariant | undefined,
): ToolChoiceOutput {
  const answers = parseAnswers(rawOutput);
  const answerMap = sv?.answerMap ?? DEFAULT_ANSWER_MAP.tool_choice;
  const labelMap = sv?.labelMap;

  const questionKey = choiceQuestionKey(answerMap);

  const q = sentReq.questions[questionKey];
  if (!q || q.type !== "choice") {
    throw new DecisionParseError(`La pregunta '${questionKey}' de selección de herramienta no es choice.`);
  }
  const { choice: rawChoice, probabilities: rawProbs } = extractChoice(answers, questionKey, (q as ChoiceQ).criteria);
  const { choice, probabilities } = applyLabelMap(rawChoice, rawProbs, labelMap);
  return { selected: choice, probabilities };
}

/**
 * Parsea la respuesta y produce `ArgsReviewOutput`.
 * Implementa la lógica de `reviewArgs`.
 */
export function parseArgsReviewDecision(
  rawOutput: string,
  sentReq: DecisionRequest,
  sv: DecisionStageVariant | undefined,
): ArgsReviewOutput {
  const answers = parseAnswers(rawOutput);
  const answerMap = sv?.answerMap ?? DEFAULT_ANSWER_MAP.args_review;
  const labelMap = sv?.labelMap;

  const questionKey = choiceQuestionKey(answerMap);

  const q = sentReq.questions[questionKey];
  if (!q || q.type !== "choice") {
    throw new DecisionParseError(`La pregunta '${questionKey}' de revisión no es choice.`);
  }
  const { choice: rawChoice, probabilities: rawProbs } = extractChoice(answers, questionKey, (q as ChoiceQ).criteria);
  const { choice, probabilities } = applyLabelMap(rawChoice, rawProbs, labelMap);

  if (!(ARGS_REVIEWS as readonly string[]).includes(choice)) {
    throw new DecisionParseError(
      `'${choice}' no es un valor válido de revisión (${ARGS_REVIEWS.join("|")}).`,
    );
  }
  return { review: choice, probabilities };
}

/**
 * Parsea la respuesta y produce `ResultVerificationOutput`.
 * Implementa la lógica de `runVerification`.
 */
export function parseResultVerificationDecision(
  rawOutput: string,
  sentReq: DecisionRequest,
  sv: DecisionStageVariant | undefined,
): ResultVerificationOutput {
  const answers = parseAnswers(rawOutput);
  const answerMap = sv?.answerMap ?? DEFAULT_ANSWER_MAP.result_verification;

  function resolveNoul(fieldKey: string): number {
    const mapping = answerMap[fieldKey];
    if (!mapping) throw new DecisionParseError(`answerMap no tiene entrada para '${fieldKey}'.`);

    if (typeof mapping === "string") {
      // pregunta noul directa
      return extractNoul(answers, mapping);
    }
    // { question, trueOption }: deriva booleano de pregunta choice
    const { question: qKey, trueOption } = mapping;
    const q = sentReq.questions[qKey];
    if (!q || q.type !== "choice") {
      throw new DecisionParseError(`answerMap: la pregunta '${qKey}' no es choice.`);
    }
    const { choice } = extractChoice(answers, qKey, (q as ChoiceQ).criteria);
    return choice === trueOption ? 1 : 0;
  }

  const okProb = resolveNoul("ok");
  const cumpleProb = resolveNoul("cumple");

  return {
    ok: okProb > NOUL_APPROVE,
    cumple: cumpleProb > NOUL_APPROVE,
    okProbability: okProb,
    cumpleProbability: cumpleProb,
  };
}

/**
 * Procesa las preguntas **extra** agregadas por una variante (7.6 §8).
 * Errores de formato son solo warnings; valores válidos van a `measurements`.
 * Devuelve `{ warnings, measurements }`.
 */
export function parseExtraQuestions(
  rawOutput: string,
  sentReq: DecisionRequest,
  baseReq: DecisionRequest,
  sv: DecisionStageVariant | undefined,
): { warnings: string[]; measurements: Record<string, string | number> } {
  const warnings: string[] = [];
  const measurements: Record<string, string | number> = {};

  const extraKeys = Object.keys(sentReq.questions).filter((k) => !Object.hasOwn(baseReq.questions, k));
  if (extraKeys.length === 0) return { warnings, measurements };

  let answers: Record<string, ParsedAnswer>;
  try {
    answers = parseAnswers(rawOutput);
  } catch {
    return { warnings, measurements };
  }

  for (const key of extraKeys) {
    const q = sentReq.questions[key];
    try {
      if (q.type === "noul") {
        const v = extractNoul(answers, key);
        measurements[`extra_${key}_noul`] = v;
      } else {
        const { choice } = extractChoice(answers, key, (q as ChoiceQ).criteria);
        measurements[`extra_${key}_choice`] = choice;
      }
    } catch (e) {
      warnings.push(`Pregunta extra '${key}': ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { warnings, measurements };
}

