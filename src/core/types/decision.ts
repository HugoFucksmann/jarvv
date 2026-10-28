/**
 * JARVIS Core — Decision 2.0.
 */

import type { TimeSpan } from "./audit.ts";

export type DecisionQuestionType = "choice" | "noul";

export interface DecisionQuestionChoice {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface DecisionQuestionNoul {
  type: "noul";
  instructions: string;
}

export type DecisionQuestion =
  | DecisionQuestionChoice
  | DecisionQuestionNoul;

/** Respuesta de una pregunta `choice`: opción elegida y distribución de probabilidades. */
export interface DecisionAnswerChoice {
  choice: string;
  probabilities: Record<string, number>;
}

/** Respuesta de una pregunta `noul`: probabilidad de la afirmativa, en [0, 1]. */
export interface DecisionAnswerNoul {
  noul: number;
}

export type DecisionAnswer =
  | DecisionAnswerChoice
  | DecisionAnswerNoul;

export interface DecisionResponse {
  answers: Record<string, DecisionAnswer>;
  rawInput: string;
  rawOutput: string;
  timing: TimeSpan;
}
