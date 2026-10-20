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
import { parseJsonObject, stripThink, validateArgs } from "../src/core/reasoner/qwen.ts";
import type {
  CaseInputArguments,
  CaseInputDecisionOne,
  DecisionAnswer,
  DecisionQuestion,
  ModelParametersRecord,
  Stage,
  VariantDecisionOne,
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

export const argumentsStage = {
  /**
   * Obtiene el prompt SYSTEM estable leído en vivo de src/core/reasoner/prompts.ts
   */
  getStableSystemPrompt(): string {
    return PROMPTS.ARGUMENTS.SYSTEM;
  },

  /**
   * Prepara el prompt final aplicando una variante (si existe) o el SYSTEM estable.
   */
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

  /**
   * Obtiene los parámetros del modelo vigentes antes de realizar cualquier llamada.
   */
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

  /**
   * Ejecuta la llamada a Qwen replicando fielmente QwenEngine.dispatchPrompt.
   * Realiza un único intento por repetición (sin reintentos automáticos).
   */
  async callModel(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{
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
    const promptEstimate = estimateTokens(systemPrompt) + estimateTokens(userPrompt);
    const available = config.qwenNumCtx - promptEstimate;
    if (available < MIN_COMPLETION_TOKENS) {
      throw new LabValidationError(
        `El prompt (~${promptEstimate} tokens) no deja espacio de salida en el contexto de ${config.qwenNumCtx} tokens.`
      );
    }
    const maxTokens = Math.min(config.qwenMaxTokens.arguments, available);

    // Parámetros derivados de ConfigManager y qwen.ts
    const body: Record<string, unknown> = {
      model: config.qwenModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: BASE_TEMPERATURE,
      max_tokens: maxTokens,
      stream: false,
      reasoning_effort: "none", // arguments siempre usa thinking = false en JARVIS
      response_format: { type: "json_object" },
    };

    const params: ModelParametersRecord = {
      url,
      model: config.qwenModel,
      temperature: BASE_TEMPERATURE,
      maxTokens,
      numCtx: config.qwenNumCtx,
      reasoningEffort: "none",
      timeoutMs: config.qwenTimeoutMs,
    };

    const t0 = Date.now();
    let result;
    try {
      result = await postJson({
        url,
        body: JSON.stringify(body),
        timeoutMs: config.qwenTimeoutMs,
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
  },

  /**
   * Capas de validación de la salida:
   * 1. JSON válido (parseJsonObject con stripThink).
   * 2. Schema match (validateArgs sobre el schema del caso).
   */
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

    // validateArgs de src/core/reasoner/qwen.ts
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
// Etapa: decision_one (Eos 0.8B)
// ============================================================

export const decisionOneStage = {
  /**
   * Aclaración arquitectónica:
   * El prompt estable de Decision #1 en casos históricos es el par { state, questions }
   * registrado en la traza original, ya que el estado se encuentra pre-renderizado.
   * No se lee DECISION_PROMPTS en vivo para esta etapa.
   */
  getStablePrompt(input: CaseInputDecisionOne): { state: string; questions: Record<string, DecisionQuestion> } {
    return {
      state: input.state,
      questions: input.questions,
    };
  },

  /**
   * Aplica una variante a un caso de Eos.
   * REGLA DE INTEGRIDAD:
   * Una variante Eos NO puede alterar las opciones del choice (criteria keys)
   * ni las claves de las preguntas del caso. Si lo intenta, falla de inmediato.
   */
  applyVariant(
    input: CaseInputDecisionOne,
    variant: VariantDecisionOne
  ): { state: string; questions: Record<string, DecisionQuestion> } {
    const overriddenQuestions: Record<string, DecisionQuestion> = {};

    for (const [qKey, originalQ] of Object.entries(input.questions)) {
      const varQ = variant.questions?.[qKey];
      if (!varQ) {
        // Sin cambios para esta pregunta
        overriddenQuestions[qKey] = originalQ;
        continue;
      }

      if (originalQ.type === "choice") {
        const origChoice = originalQ as { type: "choice"; instructions: string; criteria: Record<string, string> };
        const newInstructions = varQ.instructions !== undefined ? varQ.instructions : origChoice.instructions;
        const newCriteria: Record<string, string> = { ...origChoice.criteria };

        if (varQ.criteria) {
          // Validar que las opciones no hayan cambiado
          const origKeys = Object.keys(origChoice.criteria).sort();
          const varKeys = Object.keys(varQ.criteria).sort();

          for (const k of varKeys) {
            if (!Object.hasOwn(origChoice.criteria, k)) {
              throw new LabValidationError(
                `La variante Eos intentó agregar una opción no permitida '${k}' a la pregunta '${qKey}'. Opciones originales: ${origKeys.join(", ")}.`
              );
            }
          }

          for (const [optKey, optDesc] of Object.entries(varQ.criteria)) {
            newCriteria[optKey] = optDesc;
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

    // Verificar si la variante intentó definir preguntas que no existen en el caso
    if (variant.questions) {
      for (const varKey of Object.keys(variant.questions)) {
        if (!Object.hasOwn(input.questions, varKey)) {
          throw new LabValidationError(
            `La variante Eos incluye la pregunta '${varKey}' que no existe en el caso actual (${Object.keys(input.questions).join(", ")}).`
          );
        }
      }
    }

    return {
      state: input.state,
      questions: overriddenQuestions,
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
   * Distingue JSON inválido de fallo semántico/estructural de choices.
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

// ============================================================
// Catálogo general de etapas del laboratorio
// ============================================================

export const STAGES: Record<Stage, { name: string; model: "eos" | "qwen"; isImplemented: boolean }> = {
  decision_one: { name: "decision_one", model: "eos", isImplemented: true },
  arguments: { name: "arguments", model: "qwen", isImplemented: true },
  decision_two: { name: "decision_two", model: "eos", isImplemented: false },
  step_verification: { name: "step_verification", model: "eos", isImplemented: false },
  plan: { name: "plan", model: "qwen", isImplemented: false },
  replan: { name: "replan", model: "qwen", isImplemented: false },
  stage_verification: { name: "stage_verification", model: "qwen", isImplemented: false },
  final_response: { name: "final_response", model: "qwen", isImplemented: false },
};

/**
 * Validador de etapa implementada. Si la etapa está registrada como pendiente,
 * lanza LabStageNotImplementedError con un mensaje claro.
 */
export function assertStageImplemented(stage: string): asserts stage is "decision_one" | "arguments" {
  const norm = stage.toLowerCase() as Stage;
  if (!STAGES[norm]) {
    throw new LabValidationError(`Etapa desconocida '${stage}'. Etapas válidas: ${Object.keys(STAGES).join(", ")}`);
  }
  if (!STAGES[norm].isImplemented) {
    throw new LabStageNotImplementedError(norm);
  }
}
