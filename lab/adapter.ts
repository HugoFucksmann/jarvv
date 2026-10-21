/**
 * JARVIS Lab — Adaptador de Integración
 *
 * REGLA ESTRICTA DE ARQUITECTURA:
 * Este es el ÚNICO archivo dentro de lab/ que tiene permitido importar de src/.
 * Ningún otro archivo de lab/ debe importar nada de src/.
 *
 * Reutiliza:
 * - ConfigManager: lectura de endpoints y configuración vigente.
 * - postJson, estimateTokens, TransportError: transporte HTTP real idéntico al de JARVIS.
 * - PROMPTS.ARGUMENTS: prompt de sistema vivo para la etapa de argumentos de Qwen.
 * - parseJsonObject, validateArgs, stripThink: validación y parsing de Qwen.
 */

import { ConfigManager } from "../src/core/config.ts";
import { estimateTokens, postJson, TransportError } from "../src/core/llmTransport.ts";
import { PROMPTS } from "../src/core/reasoner/prompts.ts";
import {
  parseJsonObject,
  parsePlanSteps,
  PLAN_JSON_SCHEMA,
  REPLAN_JSON_SCHEMA,
  STAGE_VERIFICATION_JSON_SCHEMA,
  stripThink,
  validateArgs,
} from "../src/core/reasoner/qwen.ts";
import { EXECUTABLE_ROUTES, MAX_STEPS, type ExecutableRoute } from "../src/core/types.ts";
import type {
  CaseInputArguments,
  CaseInputDecisionOne,
  CaseInputEos,
  CaseInputQwen,
  DecisionAnswer,
  DecisionQuestion,
  ModelParametersRecord,
  Stage,
  VariantDecisionEos,
  VariantDecisionOne,
  VariantDecisionTwo,
  VariantStepVerification,
} from "./types.ts";

// ============================================================
// Errores específicos del Laboratorio
// ============================================================

export class LabConnectionError extends Error {
  readonly isNetwork: boolean;
  readonly isTimeout: boolean;
  constructor(service: string, url: string, message: string, cause?: unknown, isTimeout: boolean = false) {
    super(`[Lab Connection Error] No se pudo conectar con ${service} en ${url}: ${message}`, { cause });
    this.name = "LabConnectionError";
    this.isTimeout = isTimeout;
    this.isNetwork = !isTimeout;
  }
}

export class LabValidationError extends Error {
  constructor(message: string) {
    super(`[Lab Validation Error] ${message}`);
    this.name = "LabValidationError";
  }
}

export class LabStageNotImplementedError extends Error {
  constructor(stage: string) {
    super(
      `[Lab Stage Pending] La etapa '${stage}' está registrada pero aún no se encuentra implementada en el laboratorio. Etapas activas: 'decision_one', 'arguments'.`
    );
    this.name = "LabStageNotImplementedError";
  }
}

// ============================================================
// Resolutores de URL (idénticos a src/)
// ============================================================

/**
 * Resuelve la URL de Qwen de forma idéntica a QwenEngine.resolveUrl en src/core/reasoner/qwen.ts.
 * No concatena /v1/chat/completions si la URL ya lo incluye.
 */
export function resolveQwenUrl(rawUrl: string): string {
  const base = rawUrl.trim().replace(/\/+$/, "");
  if (!base) {
    throw new LabConnectionError("Qwen", rawUrl, "La URL de Qwen no está configurada en ConfigManager.");
  }
  if (base.endsWith("/v1/chat/completions")) return base;
  if (/\/(generate|api\/chat)$/.test(base)) {
    throw new LabValidationError(
      `La URL de Qwen debe ser la base o terminar en /v1/chat/completions (recibido: ${base}). Endpoints /generate y /api/chat no admitidos.`
    );
  }
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/**
 * Resuelve la URL de Decision 2.0 (Eos) de forma idéntica a Decision20Engine.systemOne.
 */
export function resolveDecisionUrl(rawUrl: string): string {
  const base = rawUrl.trim().replace(/\/+$/, "");
  if (!base) {
    throw new LabConnectionError("Decision 2.0", rawUrl, "La URL de Decision 2.0 no está configurada en ConfigManager.");
  }
  return base.endsWith("/v1/decide") ? base : `${base}/v1/decide`;
}

// ============================================================
// Parser mínimo para Decision 2.0 (Eos)
// ============================================================
// Dado que Decision20Engine.parseResponse es privado en src/core/decision.ts,
// implementamos aquí este validador mínimo equivalente para choice y noul.

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseDecisionResponse(
  rawText: string,
  questions: Record<string, DecisionQuestion>
): Record<string, DecisionAnswer> {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new LabValidationError("La respuesta de Decision 2.0 no es un JSON válido.");
  }

  if (!isRecord(data) || !isRecord(data.answers)) {
    throw new LabValidationError("La respuesta de Decision 2.0 no contiene la clave 'answers'.");
  }

  const answers: Record<string, DecisionAnswer> = {};
  for (const [key, question] of Object.entries(questions)) {
    const ans = data.answers[key];
    if (!isRecord(ans)) {
      throw new LabValidationError(`La respuesta no incluye la pregunta esperada '${key}'.`);
    }

    if (question.type === "choice") {
      const criteria = (question as { criteria?: Record<string, string> }).criteria ?? {};
      const choice = ans.choice;
      if (typeof choice !== "string" || !Object.hasOwn(criteria, choice)) {
        throw new LabValidationError(
          `Pregunta '${key}': opción ${JSON.stringify(choice)} fuera de las permitidas (${Object.keys(criteria).join(", ")}).`
        );
      }
      const probabilities = isRecord(ans.probabilities)
        ? Object.fromEntries(
            Object.entries(ans.probabilities).filter((e): e is [string, number] => typeof e[1] === "number")
          )
        : {};
      answers[key] = { choice, probabilities };
    } else if (question.type === "noul") {
      const noul = ans.noul;
      if (typeof noul !== "number" || !(noul >= 0 && noul <= 1)) {
        throw new LabValidationError(`Pregunta '${key}': 'noul' debe ser un número en [0, 1].`);
      }
      answers[key] = { noul };
    } else {
      // Tipo genérico no evaluado
      answers[key] = ans as unknown as DecisionAnswer;
    }
  }

  return answers;
}

// ============================================================
// Etapa: arguments (Qwen 3.5 9B)
// ============================================================

const BASE_TEMPERATURE = 0.1; // De src/core/reasoner/qwen.ts:~354
const MIN_COMPLETION_TOKENS = 256; // De src/core/reasoner/qwen.ts:~358

// ============================================================
// Helpers y despacho común para etapas de Qwen (3.5 9B)
// ============================================================

export interface QwenDispatchParams {
  stageName: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  thinking: boolean;
  schema?: Record<string, unknown>;
  timeoutMs: number;
}

/**
 * Despacho genérico de prompts a Qwen replicando fielmente QwenEngine.dispatchPrompt.
 * Aplica guarda de contexto, timeout diferenciado (thinking vs estándar), y formato json_schema o json_object.
 */
export async function callQwenGeneric(o: QwenDispatchParams): Promise<{
  rawOutput: string;
  parsedContent: string;
  latencyMs: number;
  params: ModelParametersRecord;
  finishReason: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  truncated: boolean;
}> {
  const config = ConfigManager.getConfig();
  const url = resolveQwenUrl(config.qwenUrl);

  // Guarda de contexto idéntica a dispatchPrompt
  const promptEstimate = estimateTokens(o.systemPrompt) + estimateTokens(o.userPrompt);
  const available = config.qwenNumCtx - promptEstimate;
  if (available < MIN_COMPLETION_TOKENS) {
    throw new LabValidationError(
      `El prompt de '${o.stageName}' (~${promptEstimate} tokens) no deja espacio de salida en el contexto de ${config.qwenNumCtx} tokens.`
    );
  }
  const maxTokens = Math.min(o.maxTokens, available);

  const body: Record<string, unknown> = {
    model: config.qwenModel,
    messages: [
      { role: "system", content: o.systemPrompt },
      { role: "user", content: o.userPrompt },
    ],
    temperature: BASE_TEMPERATURE,
    max_tokens: maxTokens,
    stream: false,
    reasoning_effort: o.thinking ? "low" : "none",
  };

  if (o.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: o.stageName, strict: false, schema: o.schema },
    };
  } else {
    body.response_format = { type: "json_object" };
  }

  const params: ModelParametersRecord = {
    url,
    model: config.qwenModel,
    temperature: BASE_TEMPERATURE,
    maxTokens,
    numCtx: config.qwenNumCtx,
    reasoningEffort: o.thinking ? "low" : "none",
    timeoutMs: o.timeoutMs,
  };

  const t0 = Date.now();
  let result;
  try {
    result = await postJson({
      url,
      body: JSON.stringify(body),
      timeoutMs: o.timeoutMs,
    });
  } catch (err) {
    if (err instanceof TransportError) {
      const isTimeout = err.kind === "timeout";
      throw new LabConnectionError("Qwen", url, err.message, err, isTimeout);
    }
    throw err;
  }

  const latencyMs = Date.now() - t0;

  if (!result.ok) {
    throw new LabConnectionError(
      "Qwen",
      url,
      `HTTP ${result.status} (${result.statusText}): ${result.text.slice(0, 300)}`
    );
  }

  let parsedResponse: any;
  try {
    parsedResponse = JSON.parse(result.text);
  } catch {
    throw new LabValidationError(`La respuesta de Qwen no es un JSON legible: ${result.text.slice(0, 300)}`);
  }

  const choice = isRecord(parsedResponse) && Array.isArray(parsedResponse.choices)
    ? parsedResponse.choices[0]
    : undefined;
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : undefined;
  const content = typeof message?.content === "string" ? message.content : "";
  const finishReason = isRecord(choice) && typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown";
  const usageObj = isRecord(parsedResponse) && isRecord(parsedResponse.usage) ? parsedResponse.usage : {};
  const usage = {
    promptTokens: typeof usageObj.prompt_tokens === "number" ? usageObj.prompt_tokens : undefined,
    completionTokens: typeof usageObj.completion_tokens === "number" ? usageObj.completion_tokens : undefined,
  };
  const truncated = finishReason === "length";

  return {
    rawOutput: result.text,
    parsedContent: content,
    latencyMs,
    params,
    finishReason,
    usage,
    truncated,
  };
}

/**
 * Llamada mínima de calentamiento para Qwen (pocos tokens, sin pensamiento, respuesta rápida).
 * Nunca realiza una llamada real de plan o replan para calentamiento.
 */
export async function warmupQwen(): Promise<{ latencyMs: number }> {
  const config = ConfigManager.getConfig();
  const res = await callQwenGeneric({
    stageName: "warmup",
    systemPrompt: "ping",
    userPrompt: "ping",
    maxTokens: 16,
    thinking: false,
    timeoutMs: config.qwenTimeoutMs,
  });
  return { latencyMs: res.latencyMs };
}

// ============================================================
// Etapa: arguments (Qwen 3.5 9B)
// ============================================================

export const argumentsStage = {
  getStableSystemPrompt(): string {
    return PROMPTS.ARGUMENTS.SYSTEM;
  },

  preparePrompt(
    input: CaseInputArguments,
    variantContent?: string
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = variantContent !== undefined ? variantContent.trim() : this.getStableSystemPrompt();
    return {
      systemPrompt,
      userPrompt: input.user,
    };
  },

  getModelParameters(): ModelParametersRecord {
    const config = ConfigManager.getConfig();
    const url = resolveQwenUrl(config.qwenUrl);
    return {
      url,
      model: config.qwenModel,
      temperature: BASE_TEMPERATURE,
      maxTokens: config.qwenMaxTokens.arguments,
      numCtx: config.qwenNumCtx,
      reasoningEffort: "none",
      timeoutMs: config.qwenTimeoutMs,
    };
  },

  async callModel(systemPrompt: string, userPrompt: string) {
    const config = ConfigManager.getConfig();
    return callQwenGeneric({
      stageName: "arguments",
      systemPrompt,
      userPrompt,
      maxTokens: config.qwenMaxTokens.arguments,
      thinking: false,
      timeoutMs: config.qwenTimeoutMs,
    });
  },

  parseAndValidate(
    content: string,
    schema: Record<string, unknown>
  ): {
    parsedJson: Record<string, unknown> | null;
    jsonValid: boolean;
    schemaValid: boolean;
    schemaError?: string;
  } {
    const cleaned = stripThink(content);
    const parsedJson = parseJsonObject(cleaned);
    const jsonValid = parsedJson !== null;

    if (!jsonValid) {
      return {
        parsedJson: null,
        jsonValid: false,
        schemaValid: false,
        schemaError: "La salida del modelo no contiene un objeto JSON válido.",
      };
    }

    // Paridad con producción (src/core/reasoner/qwen.ts:569):
    // null en un parámetro opcional equivale a "no usado" y se elimina antes de validar.
    const required = Array.isArray((schema as any)?.required)
      ? ((schema as any).required as string[])
      : [];
    for (const k of Object.keys(parsedJson)) {
      if (parsedJson[k] === null && !required.includes(k)) {
        delete parsedJson[k];
      }
    }

    const schemaProblems = validateArgs(parsedJson, schema as any);
    return {
      parsedJson,
      jsonValid: true,
      schemaValid: schemaProblems === null,
      schemaError: schemaProblems || undefined,
    };
  },
};

// ============================================================
// Etapa: stage_verification (Qwen 3.5 9B)
// ============================================================

export const STAGE_STATUSES = [
  "completed",
  "recoverable_deviation",
  "insufficient_info",
  "unrecoverable_blocked",
] as const;

export type StageVerificationStatus = (typeof STAGE_STATUSES)[number];

export const isStageStatus = (s: unknown): s is StageVerificationStatus =>
  typeof s === "string" && (STAGE_STATUSES as readonly string[]).includes(s as StageVerificationStatus);

export const stageVerificationStage = {
  getStableSystemPrompt(): string {
    return PROMPTS.STAGE_VERIFICATION.SYSTEM;
  },

  preparePrompt(
    input: CaseInputQwen,
    variantContent?: string
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = variantContent !== undefined ? variantContent.trim() : this.getStableSystemPrompt();
    return {
      systemPrompt,
      userPrompt: input.user,
    };
  },

  getModelParameters(): ModelParametersRecord {
    const config = ConfigManager.getConfig();
    const url = resolveQwenUrl(config.qwenUrl);
    return {
      url,
      model: config.qwenModel,
      temperature: BASE_TEMPERATURE,
      maxTokens: config.qwenMaxTokens.verify,
      numCtx: config.qwenNumCtx,
      reasoningEffort: "none",
      timeoutMs: config.qwenTimeoutMs,
    };
  },

  async callModel(systemPrompt: string, userPrompt: string) {
    const config = ConfigManager.getConfig();
    return callQwenGeneric({
      stageName: "stage_verification",
      systemPrompt,
      userPrompt,
      maxTokens: config.qwenMaxTokens.verify,
      thinking: false,
      schema: STAGE_VERIFICATION_JSON_SCHEMA as unknown as Record<string, unknown>,
      timeoutMs: config.qwenTimeoutMs,
    });
  },

  parseAndValidate(content: string): {
    parsedJson: Record<string, unknown> | null;
    jsonValid: boolean;
    schemaValid: boolean;
    schemaError?: string;
  } {
    const cleaned = stripThink(content);
    const parsed = parseJsonObject(cleaned);
    if (!parsed) {
      return {
        parsedJson: null,
        jsonValid: false,
        schemaValid: false,
        schemaError: "La salida del modelo no contiene un objeto JSON válido.",
      };
    }

    if (!isStageStatus(parsed.status)) {
      return {
        parsedJson: parsed,
        jsonValid: true,
        schemaValid: false,
        schemaError: `'status' debe ser uno de ${STAGE_STATUSES.join(", ")} (recibido: ${JSON.stringify(parsed.status)}).`,
      };
    }

    if (typeof parsed.reason !== "string" || !parsed.reason.trim()) {
      return {
        parsedJson: parsed,
        jsonValid: true,
        schemaValid: false,
        schemaError: "'reason' debe ser una cadena no vacía.",
      };
    }

    if (typeof parsed.question_for_user !== "string") {
      return {
        parsedJson: parsed,
        jsonValid: true,
        schemaValid: false,
        schemaError: "'question_for_user' debe ser una cadena.",
      };
    }

    if (parsed.status === "insufficient_info" && !parsed.question_for_user.trim()) {
      return {
        parsedJson: parsed,
        jsonValid: true,
        schemaValid: false,
        schemaError: 'con status "insufficient_info", question_for_user debe contener la pregunta concreta.',
      };
    }

    return {
      parsedJson: parsed,
      jsonValid: true,
      schemaValid: true,
    };
  },
};

// ============================================================
// Etapa: plan (Qwen 3.5 9B)
// ============================================================

export const planStage = {
  getStableSystemPrompt(): string {
    return PROMPTS.PLAN.SYSTEM;
  },

  preparePrompt(
    input: CaseInputQwen,
    variantContent?: string
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = variantContent !== undefined ? variantContent.trim() : this.getStableSystemPrompt();
    return {
      systemPrompt,
      userPrompt: input.user,
    };
  },

  getModelParameters(): ModelParametersRecord {
    const config = ConfigManager.getConfig();
    const url = resolveQwenUrl(config.qwenUrl);
    return {
      url,
      model: config.qwenModel,
      temperature: BASE_TEMPERATURE,
      maxTokens: config.qwenMaxTokens.plan,
      numCtx: config.qwenNumCtx,
      reasoningEffort: "low",
      timeoutMs: config.qwenThinkingTimeoutMs,
    };
  },

  async callModel(systemPrompt: string, userPrompt: string) {
    const config = ConfigManager.getConfig();
    return callQwenGeneric({
      stageName: "plan",
      systemPrompt,
      userPrompt,
      maxTokens: config.qwenMaxTokens.plan,
      thinking: true,
      schema: PLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
      timeoutMs: config.qwenThinkingTimeoutMs,
    });
  },

  parseAndValidate(content: string): {
    parsedJson: Record<string, unknown> | null;
    jsonValid: boolean;
    schemaValid: boolean;
    schemaError?: string;
  } {
    const cleaned = stripThink(content);
    const parsed = parseJsonObject(cleaned);
    if (!parsed) {
      return {
        parsedJson: null,
        jsonValid: false,
        schemaValid: false,
        schemaError: "La salida del modelo no contiene un objeto JSON válido.",
      };
    }

    if (typeof parsed.objective !== "string" || !parsed.objective.trim()) {
      return {
        parsedJson: parsed,
        jsonValid: true,
        schemaValid: false,
        schemaError: "'objective' debe ser una cadena no vacía.",
      };
    }

    // Reutilizar parsePlanSteps exportado de src/core/reasoner/qwen.ts
    // (firstNumber=1, allowEmpty=true ya que solicitudes conversacionales pueden retornar steps: [])
    const parsedSteps = parsePlanSteps(parsed.steps, 1, true);
    if ("error" in parsedSteps) {
      return {
        parsedJson: parsed,
        jsonValid: true,
        schemaValid: false,
        schemaError: parsedSteps.error,
      };
    }

    return {
      parsedJson: { ...parsed, normalizedSteps: parsedSteps.steps },
      jsonValid: true,
      schemaValid: true,
    };
  },
};

// ============================================================
// Etapa: replan (Qwen 3.5 9B)
// ============================================================

export const replanStage = {
  getStableSystemPrompt(): string {
    return PROMPTS.REPLAN.SYSTEM;
  },

  preparePrompt(
    input: CaseInputQwen,
    variantContent?: string
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = variantContent !== undefined ? variantContent.trim() : this.getStableSystemPrompt();
    return {
      systemPrompt,
      userPrompt: input.user,
    };
  },

  getModelParameters(): ModelParametersRecord {
    const config = ConfigManager.getConfig();
    const url = resolveQwenUrl(config.qwenUrl);
    return {
      url,
      model: config.qwenModel,
      temperature: BASE_TEMPERATURE,
      maxTokens: config.qwenMaxTokens.replan,
      numCtx: config.qwenNumCtx,
      reasoningEffort: "low",
      timeoutMs: config.qwenThinkingTimeoutMs,
    };
  },

  async callModel(systemPrompt: string, userPrompt: string) {
    const config = ConfigManager.getConfig();
    return callQwenGeneric({
      stageName: "replan",
      systemPrompt,
      userPrompt,
      maxTokens: config.qwenMaxTokens.replan,
      thinking: true,
      schema: REPLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
      timeoutMs: config.qwenThinkingTimeoutMs,
    });
  },

  /**
   * Validación mínima de replan equivalente a la validación inline de src/core/reasoner/qwen.ts:666-681.
   * - action debe ser "abort" o "continue"
   * - Si action === "abort": reason debe ser cadena, steps debe estar vacío.
   * - Si action === "continue": objective debe ser cadena, steps debe validarse con parsePlanSteps(parsed.steps, 1, false)
   */
  parseAndValidate(content: string): {
    parsedJson: Record<string, unknown> | null;
    jsonValid: boolean;
    schemaValid: boolean;
    schemaError?: string;
  } {
    const cleaned = stripThink(content);
    const parsed = parseJsonObject(cleaned);
    if (!parsed) {
      return {
        parsedJson: null,
        jsonValid: false,
        schemaValid: false,
        schemaError: "La salida del modelo no contiene un objeto JSON válido.",
      };
    }

    if (parsed.action === "abort") {
      if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        return {
          parsedJson: parsed,
          jsonValid: true,
          schemaValid: false,
          schemaError: 'con action "abort", "steps" debe ser un arreglo vacío.',
        };
      }
      return {
        parsedJson: parsed,
        jsonValid: true,
        schemaValid: true,
      };
    }

    if (parsed.action !== "continue") {
      return {
        parsedJson: parsed,
        jsonValid: true,
        schemaValid: false,
        schemaError: '\'action\' debe ser "continue" o "abort".',
      };
    }

    if (typeof parsed.objective !== "string" || !parsed.objective.trim()) {
      return {
        parsedJson: parsed,
        jsonValid: true,
        schemaValid: false,
        schemaError: 'con action "continue", \'objective\' debe ser una cadena no vacía.',
      };
    }

    const parsedSteps = parsePlanSteps(parsed.steps, 1, false);
    if ("error" in parsedSteps) {
      return {
        parsedJson: parsed,
        jsonValid: true,
        schemaValid: false,
        schemaError: parsedSteps.error,
      };
    }

    return {
      parsedJson: { ...parsed, normalizedSteps: parsedSteps.steps },
      jsonValid: true,
      schemaValid: true,
    };
  },
};

// ============================================================
// Etapa: decision_one (Eos 0.8B)
// ============================================================

// ============================================================
// Motor general para etapas Eos (Decision 2.0: decision_one, decision_two, step_verification)
// ============================================================

export const eosStage = {
  /**
   * Prompt estable de Eos: es el par { state, questions } registrado en la traza original,
   * ya que el estado del sistema se encuentra pre-renderizado.
   */
  getStablePrompt(input: CaseInputEos): { state: string; questions: Record<string, DecisionQuestion> } {
    return {
      state: input.state,
      questions: input.questions,
    };
  },

  /**
   * Aplica una variante a un caso de Eos respetando las reglas de cada etapa.
   *
   * REGLAS DE INTEGRIDAD:
   * 1. General: No se pueden agregar preguntas que no existan en el caso.
   * 2. step_verification:
   *    - Solo se pueden sobrescribir `instructions` de 'ok' y/o 'cumple'.
   *    - El tipo 'noul' no cambia y no admite 'criteria'.
   * 3. decision_one:
   *    - Solo pregunta 'route'.
   *    - No se pueden agregar opciones a criteria (deben coincidir con las del caso).
   * 4. decision_two:
   *    - Solo pregunta 'selected_tool'.
   *    - Se pueden sobrescribir instructions y criteria (descripción de herramientas).
   *    - Las herramientas que no existan en el caso se ignoran para ese caso con aviso.
   *    - Nunca se agregan herramientas nuevas al prompt del caso.
   */
  applyVariant(
    stage: Stage,
    input: CaseInputEos,
    variant: VariantDecisionEos | VariantStepVerification,
    caseId?: string
  ): {
    state: string;
    questions: Record<string, DecisionQuestion>;
    matchedToolKeys: string[];
    unmatchedToolKeys: string[];
  } {
    const overriddenQuestions: Record<string, DecisionQuestion> = {};
    const matchedToolKeys: string[] = [];
    const unmatchedToolKeys: string[] = [];

    // Validar preguntas no permitidas por etapa
    if (variant.questions) {
      for (const varKey of Object.keys(variant.questions)) {
        if (!Object.hasOwn(input.questions, varKey)) {
          if (stage === "step_verification") {
            throw new LabValidationError(
              `La variante de step_verification solo puede modificar las preguntas 'ok' y/o 'cumple'. Pregunta no permitida: '${varKey}'.`
            );
          } else if (stage === "decision_two") {
            throw new LabValidationError(
              `La variante de decision_two solo puede modificar la pregunta 'selected_tool'. Pregunta no permitida: '${varKey}'.`
            );
          } else if (stage === "decision_one") {
            throw new LabValidationError(
              `La variante de decision_one solo puede modificar la pregunta 'route'. Pregunta no permitida: '${varKey}'.`
            );
          } else {
            throw new LabValidationError(
              `La variante Eos incluye la pregunta '${varKey}' que no existe en el caso actual (${Object.keys(input.questions).join(", ")}).`
            );
          }
        }
      }
    }

    for (const [qKey, originalQ] of Object.entries(input.questions)) {
      const varQ = variant.questions?.[qKey];
      if (!varQ) {
        overriddenQuestions[qKey] = originalQ;
        continue;
      }

      // Reglas para step_verification (tipo noul)
      if (stage === "step_verification") {
        if ("criteria" in varQ && varQ.criteria) {
          throw new LabValidationError(
            `La variante de step_verification no admite 'criteria' en la pregunta '${qKey}' (debe ser tipo 'noul').`
          );
        }
        if ("type" in varQ && (varQ as any).type !== "noul") {
          throw new LabValidationError(
            `La variante de step_verification no puede modificar el tipo de la pregunta '${qKey}' (debe ser 'noul').`
          );
        }

        const newInstructions = varQ.instructions !== undefined ? varQ.instructions : originalQ.instructions;
        overriddenQuestions[qKey] = {
          type: "noul",
          instructions: newInstructions || "",
        };
        continue;
      }

      // Reglas para decision_one y decision_two (tipo choice)
      if (originalQ.type === "choice") {
        const origChoice = originalQ as { type: "choice"; instructions: string; criteria: Record<string, string> };
        const newInstructions = varQ.instructions !== undefined ? varQ.instructions : origChoice.instructions;
        const newCriteria: Record<string, string> = { ...origChoice.criteria };

        if ("criteria" in varQ && varQ.criteria) {
          if (stage === "decision_one") {
            // En decision_one no se permiten opciones desconocidas
            const origKeys = Object.keys(origChoice.criteria).sort();
            for (const k of Object.keys(varQ.criteria)) {
              if (!Object.hasOwn(origChoice.criteria, k)) {
                throw new LabValidationError(
                  `La variante de decision_one intentó agregar una opción no permitida '${k}' a la pregunta '${qKey}'. Opciones permitidas: ${origKeys.join(", ")}.`
                );
              }
              newCriteria[k] = varQ.criteria[k];
              matchedToolKeys.push(k);
            }
          } else if (stage === "decision_two") {
            // En decision_two las herramientas varían por caso.
            // B1: Si la descripción en el caso termina con "[last attempt failed]" (añadido por buildDecisionTwo),
            // la variante reemplaza solo la parte base y conserva el sufijo.
            const FAILED_SUFFIX = "[last attempt failed]";
            for (const [toolKey, toolDesc] of Object.entries(varQ.criteria)) {
              if (Object.hasOwn(origChoice.criteria, toolKey)) {
                const origDesc = origChoice.criteria[toolKey] || "";
                const hadFailedSuffix = origDesc.trim().endsWith(FAILED_SUFFIX);
                let finalDesc = toolDesc;
                if (hadFailedSuffix && !finalDesc.trim().endsWith(FAILED_SUFFIX)) {
                  finalDesc = `${finalDesc.trimEnd()} ${FAILED_SUFFIX}`;
                }
                newCriteria[toolKey] = finalDesc;
                matchedToolKeys.push(toolKey);
              } else {
                unmatchedToolKeys.push(toolKey);
                console.log(
                  `ℹ [decision_two] Caso '${caseId || "desconocido"}': la herramienta '${toolKey}' de la variante no existe en el caso; se ignora.`
                );
              }
            }
          } else {
            for (const [k, v] of Object.entries(varQ.criteria)) {
              newCriteria[k] = v;
            }
          }
        }

        overriddenQuestions[qKey] = {
          type: "choice",
          instructions: newInstructions,
          criteria: newCriteria,
        };
      } else {
        const newInstructions = varQ.instructions !== undefined ? varQ.instructions : originalQ.instructions;
        overriddenQuestions[qKey] = {
          ...originalQ,
          instructions: newInstructions || "",
        };
      }
    }

    return {
      state: input.state,
      questions: overriddenQuestions,
      matchedToolKeys,
      unmatchedToolKeys,
    };
  },

  /**
   * Obtiene los parámetros del modelo vigentes antes de realizar cualquier llamada.
   */
  getModelParameters(): ModelParametersRecord {
    const config = ConfigManager.getConfig();
    const url = resolveDecisionUrl(config.decisionUrl);
    return {
      url,
      timeoutMs: config.decisionTimeoutMs,
      numCtx: config.decisionMaxContext,
    };
  },

  /**
   * Ejecuta la llamada a Decision 2.0 (Eos) contra el endpoint HTTP real.
   */
  async callModel(
    state: string,
    questions: Record<string, DecisionQuestion>
  ): Promise<{ rawOutput: string; latencyMs: number; params: ModelParametersRecord }> {
    const config = ConfigManager.getConfig();
    const url = resolveDecisionUrl(config.decisionUrl);

    const payload = { state, questions };
    const body = JSON.stringify(payload);

    const estimated = estimateTokens(body);
    if (estimated > config.decisionMaxContext) {
      throw new LabValidationError(
        `Desbordamiento de contexto en Decision 2.0: ~${estimated} tokens superan el límite de ${config.decisionMaxContext}.`
      );
    }

    const params: ModelParametersRecord = {
      url,
      timeoutMs: config.decisionTimeoutMs,
      numCtx: config.decisionMaxContext,
    };

    const t0 = Date.now();
    let result;
    try {
      result = await postJson({
        url,
        body,
        timeoutMs: config.decisionTimeoutMs,
      });
    } catch (err) {
      if (err instanceof TransportError) {
        const isTimeout = err.kind === "timeout";
        throw new LabConnectionError("Decision 2.0", url, err.message, err, isTimeout);
      }
      throw err;
    }

    const latencyMs = Date.now() - t0;

    if (!result.ok) {
      throw new LabConnectionError(
        "Decision 2.0",
        url,
        `HTTP ${result.status} (${result.statusText}): ${result.text.slice(0, 300)}`
      );
    }

    return {
      rawOutput: result.text,
      latencyMs,
      params,
    };
  },

  /**
   * Parsea y valida la salida de Decision 2.0 contra las preguntas.
   */
  parseOutput(
    rawText: string,
    questions: Record<string, DecisionQuestion>
  ): {
    answers: Record<string, DecisionAnswer> | null;
    jsonValid: boolean;
    schemaValid: boolean;
    error?: string;
  } {
    try {
      JSON.parse(rawText);
    } catch {
      return {
        answers: null,
        jsonValid: false,
        schemaValid: false,
        error: "La respuesta de Decision 2.0 no es un JSON válido.",
      };
    }

    try {
      const answers = parseDecisionResponse(rawText, questions);
      return {
        answers,
        jsonValid: true,
        schemaValid: true,
      };
    } catch (err) {
      return {
        answers: null,
        jsonValid: true,
        schemaValid: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// Aliases para compatibilidad por nombre de etapa
export const decisionOneStage = eosStage;
export const decisionTwoStage = eosStage;
export const stepVerificationStage = eosStage;

// ============================================================
// Catálogo general de etapas del laboratorio
// ============================================================

export const STAGES: Record<Stage, { name: string; model: "eos" | "qwen"; isImplemented: boolean }> = {
  decision_one: { name: "decision_one", model: "eos", isImplemented: true },
  arguments: { name: "arguments", model: "qwen", isImplemented: true },
  decision_two: { name: "decision_two", model: "eos", isImplemented: true },
  step_verification: { name: "step_verification", model: "eos", isImplemented: true },
  stage_verification: { name: "stage_verification", model: "qwen", isImplemented: true },
  plan: { name: "plan", model: "qwen", isImplemented: true },
  replan: { name: "replan", model: "qwen", isImplemented: true },
  final_response: { name: "final_response", model: "qwen", isImplemented: false },
};

/**
 * Validador de etapa implementada. Si la etapa está registrada como pendiente,
 * lanza LabStageNotImplementedError con un mensaje claro.
 */
export function assertStageImplemented(
  stage: string
): asserts stage is
  | "decision_one"
  | "decision_two"
  | "step_verification"
  | "arguments"
  | "stage_verification"
  | "plan"
  | "replan" {
  const norm = stage.toLowerCase() as Stage;
  if (!STAGES[norm]) {
    throw new LabValidationError(`Etapa desconocida '${stage}'. Etapas válidas: ${Object.keys(STAGES).join(", ")}`);
  }
  if (!STAGES[norm].isImplemented) {
    throw new LabStageNotImplementedError(norm);
  }
}
