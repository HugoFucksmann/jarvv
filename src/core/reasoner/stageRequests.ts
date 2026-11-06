/**
 * JARVIS Core — Petición de cada etapa generativa (plan, argumentos, pregunta y respuesta final), sin transporte.
 *
 * Reúne en un solo lugar lo que define qué se le pide al modelo en cada etapa: prompts, schema, tope de tokens y thinking.
 * `QwenEngine` la usa para despachar y validar; el laboratorio de evaluación (`eval/`) la usa para armar exactamente la misma
 * petición, de modo que un cambio aquí se refleja en las dos sin copiar nada.
 */

import { BUDGET } from "../budget.ts";
import type { JarvisConfig } from "../config.ts";
import type { ArgsFromViewInput, FinalFromViewInput, PlanFromViewInput, QuestionInput } from "../engine/deps.ts";
import { buildCompactCatalog } from "../tools/manifest.ts";
import { EXECUTABLE_ROUTES, MAX_STEPS, type PlanStepWire } from "../types.ts";
import { PROMPTS } from "./prompts.ts";

type JsonSchema = Record<string, unknown>;

/** Temperatura del primer intento de toda etapa. */
export const BASE_TEMPERATURE = 0.1;

/** Política de reintento por salida inválida o truncada: temperatura, factor de tokens y mensaje del error de truncado. */
export const RETRY_TEMPERATURE = 0.3;
export const RETRY_TOKEN_FACTOR = 1.5;
export const TRUNCATED = "la salida se truncó por el límite de tokens";

/** Lo que define una consulta al modelo generativo, antes de enviarla. */
export interface StageRequest {
  stage: string;
  system: string;
  user: string;
  /** Pide JSON (json_schema si hay `schema`; si no, json_object). */
  json: boolean;
  schema?: JsonSchema;
  maxTokens: number;
  thinking: boolean;
  /** Thinking en el reintento; por defecto el mismo. */
  retryThinking?: boolean;
}

/** Parte de la configuración que fija tokens y thinking por etapa. */
export type StageConfig = Pick<JarvisConfig, "qwenMaxTokens" | "thinking">;

/** Claves del paso en el contrato con el LLM (PlanStepWire): `satisfies` obliga a que schema y tipo coincidan. */
const STEP_WIRE_PROPERTIES = {
  goal: { type: "string" },
  suggested_mcp: { type: "string", enum: [...EXECUTABLE_ROUTES] },
  expected_outcome: { type: "string" },
} satisfies Record<keyof PlanStepWire, JsonSchema>;

const STEPS_SCHEMA: JsonSchema = {
  type: "array",
  items: {
    type: "object",
    properties: STEP_WIRE_PROPERTIES,
    required: Object.keys(STEP_WIRE_PROPERTIES),
    additionalProperties: false,
  },
  maxItems: MAX_STEPS,
};

/** Plan desde la vista (Fase 6): solo `steps`, de 1 a `maxSteps` (el tope lo pasa el motor). */
export function planViewSchema(maxSteps: number): JsonSchema {
  return {
    type: "object",
    properties: { steps: { ...STEPS_SCHEMA, minItems: 1, maxItems: maxSteps } },
    required: ["steps"],
    additionalProperties: false,
  };
}

/** LLM 1: plan y replan. Thinking siempre activo. */
export function planStageRequest(input: PlanFromViewInput, config: StageConfig): StageRequest {
  const tokens = config.qwenMaxTokens;
  return {
    stage: "plan",
    system: PROMPTS.PLAN_VIEW.SYSTEM,
    user: PROMPTS.PLAN_VIEW.buildUserPrompt({ view: input.view, maxSteps: input.maxSteps, catalog: buildCompactCatalog() }),
    json: true,
    schema: planViewSchema(input.maxSteps),
    maxTokens: input.trigger === "initial" ? tokens.plan : tokens.replan,
    thinking: true,
  };
}

/** Argumentos de la herramienta: `json_object` (los schemas de las herramientas son dinámicos), sin thinking. */
export function argumentsStageRequest(input: ArgsFromViewInput, config: StageConfig): StageRequest {
  return {
    stage: "arguments",
    system: PROMPTS.ARGUMENTS_VIEW.buildSystemPrompt(input.tool),
    user: PROMPTS.ARGUMENTS_VIEW.buildUserPrompt(input),
    json: true,
    maxTokens: config.qwenMaxTokens.arguments,
    thinking: false,
  };
}

/** Pregunta al usuario (`ask_user`): texto libre, sin thinking. */
export function questionStageRequest(input: QuestionInput): StageRequest {
  return {
    stage: "question",
    system: PROMPTS.QUESTION.SYSTEM,
    user: PROMPTS.QUESTION.buildUserPrompt(input),
    json: false,
    maxTokens: BUDGET.ask.maxTokens,
    thinking: false,
  };
}

/** LLM 3: respuesta final. Thinking según la configuración; el reintento lo apaga (un final vacío suele ser thinking agotado). */
export function finalStageRequest(input: FinalFromViewInput, config: StageConfig): StageRequest {
  return {
    stage: "final_response",
    system: PROMPTS.FINAL_VIEW.SYSTEM,
    user: PROMPTS.FINAL_VIEW.buildUserPrompt(input),
    json: false,
    maxTokens: config.qwenMaxTokens.final,
    thinking: config.thinking,
    retryThinking: false,
  };
}
