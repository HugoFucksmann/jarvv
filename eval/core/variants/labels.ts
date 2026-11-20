/**
 * eval/core/variants/labels.ts
 *
 * Helpers de lectura de respuestas de decisión para las etapas y variantes.
 * Valida respuestas individuales con el mismo código que producción (`src/core/models/decision.ts`).
 */

import { parseAnswersObject, validateAnswer } from "../contract.ts";
import type { ChoiceQ, DecisionRequest } from "../types.ts";

// ───────────────────────── Error de parseo ─────────────────────────

export class DecisionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionParseError";
  }
}

/** Claves de las preguntas por fragmento (`f0`, `f1`…) que trae un request, en orden. */
export function fragmentKeys(req: DecisionRequest): string[] {
  return Object.keys(req.questions)
    .filter((k) => /^f\d+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

// ───────────────────────── Parseo de la respuesta cruda ─────────────────────────

export interface ParsedAnswer {
  choice?: string;
  probabilities?: Record<string, number>;
  noul?: number;
}

/** El objeto `answers` de la respuesta cruda. Valida con el mismo código que producción (`src/core/models/decision.ts`). */
export function parseAnswers(rawOutput: string): Record<string, ParsedAnswer> {
  try {
    return parseAnswersObject(rawOutput) as Record<string, ParsedAnswer>;
  } catch (e) {
    throw new DecisionParseError(e instanceof Error ? e.message : String(e));
  }
}

/** Extrae el valor de una pregunta `choice` de los answers. Lanza si falta o no está en criteria. */
export function extractChoice(
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
export function extractNoul(answers: Record<string, ParsedAnswer>, questionKey: string): number {
  try {
    const a = validateAnswer(questionKey, { type: "noul", instructions: "" }, answers[questionKey]);
    if (!("noul" in a)) throw new Error(`La respuesta de '${questionKey}' no es de tipo noul.`);
    return a.noul;
  } catch (e) {
    throw new DecisionParseError(e instanceof Error ? e.message : String(e));
  }
}

/** Valida la pregunta `choice` principal de una etapa y devuelve su elección y probabilidades. */
export function mainChoice(
  stage: string,
  questionKey: string,
  answers: Record<string, ParsedAnswer>,
  sentReq: DecisionRequest,
): { choice: string; probabilities: Record<string, number> } {
  const q = sentReq.questions[questionKey];
  if (!q || q.type !== "choice") {
    throw new DecisionParseError(`La pregunta '${questionKey}' de la etapa '${stage}' no es choice o no existe.`);
  }
  return extractChoice(answers, questionKey, (q as ChoiceQ).criteria);
}

