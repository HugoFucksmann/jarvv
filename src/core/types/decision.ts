import type { TimeSpan } from "./audit.ts";
import type { StepRoute } from "./routes.ts";
import type { MCPTool } from "./mcp.ts";

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

export interface DecisionOneResult {
  route: StepRoute;
  probabilities: Record<string, number>;
  rawInput: string;
  rawOutput: string;
  timing: TimeSpan;
}

export interface DecisionTwoResult {
  selectedTool: MCPTool;
  probabilities: Record<string, number>;
  rawInput: string;
  rawOutput: string;
  /** `true`: no hubo llamada al modelo (una sola herramienta posible); `rawInput`/`rawOutput` son sintéticos y no hay `timing`. */
  shortcut?: boolean;
  timing?: TimeSpan;
}

/** Resultado de la verificación factual de un paso con Eos. */
export interface StepVerificationResult {
  ok: boolean;
  cumple: boolean;
  okProbability: number;
  cumpleProbability: number;
  rawInput: string;
  rawOutput: string;
  timing: TimeSpan;
}