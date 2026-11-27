import type { TimeSpan } from "./audit.ts";

export type DecisionAnswer =
  | DecisionAnswerChoice
  | DecisionAnswerNoul
  | DecisionAnswerScore;

export interface DecisionAnswerChoice {
  choice: string;
  probabilities: Record<string, number>;
}

/** Respuesta de una pregunta `noul`: probabilidad de la afirmativa, en [0, 1]. */
export interface DecisionAnswerNoul {
  noul: number;
}

/**
 * Respuesta de una pregunta `score`: `score` es el nivel esperado que calcula el servidor (entre 0 y niveles - 1: con cinco niveles, 1,4 está entre «solo nombrado» y
 * «en parte») y `probabilities` la probabilidad de cada nivel (clave = índice del nivel, de `"0"` a `"n-1"`). Para decidir se usa la masa de los niveles altos
 * (`upperLevelsMass`), que no se deja arrastrar por una cola larga como sí lo hace el promedio.
 */
export interface DecisionAnswerScore {
  score: number;
  probabilities: Record<string, number>;
}

export type DecisionQuestion =
  | DecisionQuestionChoice
  | DecisionQuestionNoul
  | DecisionQuestionScore;

export interface DecisionResponse {
  answers: Record<string, DecisionAnswer>;
  rawInput: string;
  rawOutput: string;
  timing: TimeSpan;
}

interface DecisionQuestionChoice {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

/** Una escala de 2 a 10 niveles, del peor (índice 0) al mejor. El servidor devuelve la probabilidad de cada nivel. */
interface DecisionQuestionScore {
  type: "score";
  instructions: string;
  criteria: readonly string[];
}

/** Probabilidad de que el nivel sea de la mitad superior de la escala (para 5 niveles: 2, 3 o 4). `null` si la respuesta no trae probabilidades por nivel. */
export function upperLevelsMass(answer: DecisionAnswerScore, levels: number): number | null {
  const from = Math.floor(levels / 2);
  let mass = 0;
  let seen = 0;
  for (let i = 0; i < levels; i++) {
    const p = answer.probabilities[String(i)];
    if (typeof p !== "number") continue;
    seen++;
    if (i >= from) mass += p;
  }
  return seen === 0 ? null : Math.min(1, mass);
}

export interface DecisionQuestionNoul {
  type: "noul";
  instructions: string;
  /** Qué significa responder sí (`true`) y no (`false`): quita la zona gris de la pregunta. Opcional. */
  criteria?: { true: string; false: string };
}
