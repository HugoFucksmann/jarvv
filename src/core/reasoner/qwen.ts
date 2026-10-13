import {
  Step,
  StepRoute,
  MCPTool,
  Plan,
  Scratchpad,
  Evidence,
  MAX_STEPS,
  MAX_ARG_RETRIES,
  QWEN_CTX,
  EscalationResponse,
  StageVerificationResult,
  StageVerificationPromptData,
} from "../types.ts";
import { ConfigManager } from "../config.ts";
import {
  PROMPTS,
  ArgumentPromptData,
  EscalationPromptData,
  FinalResponsePromptData,
  ReplanPromptData,
} from "./prompts.ts";
import { cleanInputSchema } from "../mcp/discovery.ts";
import { buildCompactCatalog } from "../tools/manifest.ts";

export class LLMServiceUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(`[Qwen 3.5 9B Unavailable] ${message}`);
    this.name = "LLMServiceUnavailableError";
  }
}

export class LLMValidationError extends Error {
  constructor(message: string) {
    super(`[Qwen 3.5 9B Validation] ${message}`);
    this.name = "LLMValidationError";
  }
}

export const VALID_STEP_ROUTES: readonly StepRoute[] = [
  "windows",
  "desktop_commander",
  "free_search",
] as const;

/**
 * Type Guard formal para validar rutas de subsistemas MCP en tiempo de ejecución
 */
export function isStepRoute(route: unknown): route is StepRoute {
  return typeof route === "string" && (VALID_STEP_ROUTES as readonly string[]).includes(route);
}

// ============================================================
// Esquemas JSON estrictos para Structured Outputs (§9.1, §9.4)
// ============================================================

export const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    objective: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          goal: { type: "string" },
          suggested_mcp: {
            type: "string",
            enum: ["windows", "desktop_commander", "free_search"],
          },
          expected_outcome: { type: "string" },
          dependencies: {
            type: "array",
            items: { type: "string" },
          },
          candidate_tools: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "goal", "suggested_mcp", "expected_outcome"],
        additionalProperties: false,
      },
    },
  },
  required: ["objective", "steps"],
  additionalProperties: false,
} as const;

export const REPLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["continue", "abort"],
    },
    reason: { type: "string" },
    objective: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          goal: { type: "string" },
          suggested_mcp: {
            type: "string",
            enum: ["windows", "desktop_commander", "free_search"],
          },
          expected_outcome: { type: "string" },
          dependencies: {
            type: "array",
            items: { type: "string" },
          },
          candidate_tools: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "goal", "suggested_mcp", "expected_outcome"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
} as const;

export const STAGE_VERIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["completed", "recoverable_deviation", "insufficient_info", "unrecoverable_blocked"],
    },
    reason: { type: "string" },
    question_for_user: { type: "string" },
  },
  required: ["status", "reason"],
  additionalProperties: false,
} as const;

export interface ILLMClient {
  generateArguments(
    stepOrData: Step | ArgumentPromptData,
    tool?: MCPTool,
    scratchpad?: Scratchpad,
    context?: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>>;

  /**
   * @deprecated Fase 3: Migrada a Core determinista + arbitraje de Decision 2.0 Eos (handleEscalation).
   */
  escalate(
    data: EscalationPromptData,
    signal?: AbortSignal
  ): Promise<EscalationResponse>;

  generateFinalResponse(
    data: FinalResponsePromptData,
    signal?: AbortSignal
  ): Promise<string>;

  generatePlan(
    userMessage: string,
    scratchpadOrChat?: Scratchpad | string,
    signal?: AbortSignal,
    compactCatalog?: string,
    modificationFeedback?: string,
    existingPlanSummary?: string
  ): Promise<Plan>;

  replan(
    data: ReplanPromptData,
    signal?: AbortSignal
  ): Promise<{ action?: "abort"; reason?: string; plan?: Plan }>;

  /**
   * Fase 3B: Verificación semántica de etapa frente a objetivo observable (§3.2.6)
   */
  verifyStage(
    data: StageVerificationPromptData,
    signal?: AbortSignal
  ): Promise<StageVerificationResult>;

  generateChatResponse(
    instruction: string,
    scratchpad: Scratchpad
  ): Promise<string>;

  synthesizeFinalResponse(
    taskMessage: string,
    steps: Step[],
    scratchpad: Scratchpad,
    evidenceList: Evidence[]
  ): Promise<string>;
}

export class QwenEngine implements ILLMClient {
  /**
   * Helper unificado para parsear JSON tolerante a texto explicativo o Markdown
   */
  private safeJsonParse<T = any>(raw: string): T | null {
    if (!raw || typeof raw !== "string") return null;
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch { }
      }
    }
    return null;
  }

  /**
   * Helper unificado para convertir Scratchpad a un diccionario plano de cadenas
   */
  private scratchpadToFacts(scratchpad?: Scratchpad): Record<string, string> {
    if (!scratchpad) return {};
    return Object.entries(scratchpad).reduce((acc, [k, v]) => {
      if (v && typeof v === "string") acc[k] = v;
      return acc;
    }, {} as Record<string, string>);
  }

  /**
   * Helper to wrap stages with concise observability logging.
   */
  private async executeStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    console.log(`[Qwen] ${stage} start`);
    try {
      const result = await fn();
      const duration = Date.now() - t0;
      console.log(`[Qwen] ${stage} done duration=${duration}ms`);
      return result;
    } catch (err: any) {
      const duration = Date.now() - t0;
      const isTimeout =
        err?.name === "TimeoutError" ||
        err?.message?.toLowerCase().includes("timeout") ||
        err?.cause?.name === "TimeoutError";
      if (isTimeout) {
        console.error(`[Qwen] ${stage} timeout duration=${duration}ms`);
      } else {
        const errMsg = err?.message || String(err);
        console.error(`[Qwen] ${stage} error=${errMsg.replace(/\r?\n/g, " ").slice(0, 100)} duration=${duration}ms`);
      }
      throw err;
    }
  }

  /**
   * Dispatches inference requests to configured Qwen endpoint (§10.10)
   */
  private async dispatchPrompt(
    systemPrompt: string,
    userPrompt: string,
    expectJson = true,
    maxTokens?: number,
    options?: {
      stage?: string;
      thinking?: boolean;
      signal?: AbortSignal;
      schema?: Record<string, unknown>;
    }
  ): Promise<string> {
    const config = ConfigManager.getConfig();
    const endpointUrl = config.qwenUrl?.trim();

    if (!endpointUrl) {
      throw new LLMServiceUnavailableError(
        "La URL del servicio Qwen 3.5 9B no está configurada. Configure la URL en la barra de configuración."
      );
    }

    let url = endpointUrl;
    if (url.endsWith("/")) url = url.slice(0, -1);
    if (!url.endsWith("/v1/chat/completions") && !url.endsWith("/generate") && !url.endsWith("/api/chat")) {
      url = `${url}/v1/chat/completions`;
    }

    const modelName = config.qwenModel?.trim();
    const isThinking = options?.thinking !== undefined
      ? options.thinking
      : Boolean(config.thinking);

    console.log(`[Qwen → SEND] stage=${options?.stage || 'unknown'} system=${JSON.stringify(systemPrompt).slice(0, 200)} user=${JSON.stringify(userPrompt).slice(0, 300)}`);

    const bodyPayload: any = {
      ...(modelName ? { model: modelName } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      stream: false,
      ...(isThinking
        ? { reasoning_effort: "low", think: true }
        : { reasoning_effort: "none", think: false }),
      options: {
        num_ctx: QWEN_CTX,
        ...(maxTokens ? { num_predict: maxTokens } : {}),
        think: isThinking,
      },
    };

    if (maxTokens) {
      bodyPayload.max_tokens = maxTokens;
    }

    if (options?.schema) {
      bodyPayload.response_format = {
        type: "json_schema",
        json_schema: {
          name: options.stage || "structured_output",
          strict: true,
          schema: options.schema,
        },
      };
      bodyPayload.format = options.schema;
    } else if (expectJson) {
      bodyPayload.response_format = { type: "json_object" };
      bodyPayload.format = "json";
    }

    const baseTimeout = config.qwenTimeoutMs ?? config.timeoutMs ?? 120000;
    // En modo pensamiento (isThinking), la inferencia requiere más tiempo por la generación de tokens de razonamiento.
    // Garantizamos al menos 180s o el doble del timeout base para evitar que AbortSignal aborte prematuramente en local.
    const timeoutMs = isThinking
      ? Math.max(baseTimeout * 2, 180000)
      : baseTimeout;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    const t0 = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "ngrok-skip-browser-warning": "true",
          "bypass-tunnel-reminder": "true",
        },
        body: JSON.stringify(bodyPayload),
        signal: combinedSignal,
      });
    } catch (err: any) {
      if (err.name === "AbortError" && options?.signal?.aborted) {
        throw new Error("Operación de Qwen 3.5 9B cancelada por el usuario.");
      }
      if (err.name === "TimeoutError") {
        throw new LLMServiceUnavailableError(`Timeout al conectar con Qwen 3.5 9B en ${url}`, err);
      }
      throw new LLMServiceUnavailableError(
        `No fue posible conectar con el servicio Qwen 3.5 9B en ${url}. Verifique que Ollama/vLLM esté activo.`,
        err
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new LLMServiceUnavailableError(
        `Qwen 3.5 9B HTTP error ${response.status} (${response.statusText}): ${errText}`
      );
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new LLMValidationError("La respuesta de Qwen 3.5 9B no contiene un JSON legible.");
    }

    const durationMs = Date.now() - t0;
    const promptTokens = data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? data.eval_count ?? 0;
    const firstChoice = data.choices?.[0];
    const finishReason = firstChoice?.finish_reason || data.done_reason || firstChoice?.stop_reason || (data.done ? "stop" : "unknown");
    const isLengthExceeded = finishReason === "length";
    const stageLabel = options?.stage || "inference";
    const thinkingLabel = isThinking ? "yes" : "no";

    console.log(`[Qwen ← RECV] stage=${stageLabel} raw=${JSON.stringify(data).slice(0, 400)}`);
    console.log(
      `[Qwen] stage=${stageLabel} tokens=(in=${promptTokens}, out=${completionTokens}, max=${maxTokens ?? "default"}) finish_reason=${finishReason}${isLengthExceeded ? " [LENGTH_EXCEEDED]" : ""} thinking=${thinkingLabel} duration=${durationMs}ms`
    );

    const messageObj = firstChoice?.message || data.message;

    let content: string | undefined;
    if (typeof messageObj?.content === "string" && messageObj.content.trim()) {
      content = messageObj.content;
    } else if (typeof data.response === "string" && data.response.trim()) {
      content = data.response;
    } else if (typeof firstChoice?.text === "string" && firstChoice.text.trim()) {
      content = firstChoice.text;
    }

    // Extraer traza de pensamiento / razonamiento de todas las llaves posibles de Ollama y OpenAI/vLLM
    const thinkingTrace =
      (typeof messageObj?.reasoning_content === "string" && messageObj.reasoning_content.trim() ? messageObj.reasoning_content.trim() : "") ||
      (typeof messageObj?.thinking === "string" && messageObj.thinking.trim() ? messageObj.thinking.trim() : "") ||
      (typeof data?.thinking === "string" && data.thinking.trim() ? data.thinking.trim() : "") ||
      (typeof firstChoice?.reasoning_content === "string" && firstChoice.reasoning_content.trim() ? firstChoice.reasoning_content.trim() : "");

    // Si content vino vacío pero hay thinkingTrace disponible, usar la traza de pensamiento como respuesta
    if (!content && thinkingTrace) {
      console.log(`[Qwen] content venía vacío pero se extrajo respuesta de la llave de pensamiento (${thinkingTrace.length} chars).`);
      content = thinkingTrace;
    }

    // Si content es una frase genérica de confirmación de cierre ("tarea completada con éxito") mientras thinkingTrace contiene la respuesta real
    if (
      content &&
      thinkingTrace &&
      content.length < 90 &&
      /tarea\s+(concluida|completada|finalizada|terminada)/i.test(content) &&
      thinkingTrace.length > content.length
    ) {
      console.log(`[Qwen] content contenía solo frase genérica de cierre ("${content}"). Priorizando respuesta detallada de traza de pensamiento (${thinkingTrace.length} chars).`);
      content = thinkingTrace;
    }

    if (!content || typeof content !== "string" || !content.trim()) {
      const rawSnippet = typeof data === "object" ? JSON.stringify(data).slice(0, 300) : String(data).slice(0, 300);
      console.error(`[Qwen] Respuesta vacía o no reconocida. finish_reason=${finishReason}. Raw (primeros 300 chars): ${rawSnippet}`);
      if (isLengthExceeded) {
        throw new LLMValidationError(`Respuesta de Qwen 3.5 9B cortada por longitud (finish_reason=length, tokens out=${completionTokens}/${maxTokens}).`);
      }
      throw new LLMValidationError(`Respuesta de Qwen 3.5 9B vacía o no reconocida. finish_reason=${finishReason}`);
    }

    return content.trim();
  }

  /**
   * Etapa 3: Generación de argumentos con validación y reintentos (§4, §10.2)
   */
  async generateArguments(
    stepOrData: Step | ArgumentPromptData,
    toolParam?: MCPTool,
    scratchpadParam?: Scratchpad,
    contextParam?: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    return await this.executeStage("generateArguments", async () => {
      let promptData: ArgumentPromptData;
      let targetTool: MCPTool;

      if ("goal" in stepOrData && "tool" in stepOrData) {
        promptData = stepOrData as ArgumentPromptData;
        targetTool = promptData.tool;
      } else {
        const step = stepOrData as Step;
        targetTool = toolParam!;
        promptData = {
          goal: contextParam || step.instruction,
          tool: targetTool,
          cleanedSchema: cleanInputSchema(targetTool.inputSchema || {}),
          taskInstruction: step.instruction,
          facts: this.scratchpadToFacts(scratchpadParam),
        };
      }

      const required = (targetTool.inputSchema?.required as string[]) || [];
      let previousError: string | undefined;
      let attempts = 0;

      while (attempts <= MAX_ARG_RETRIES) {
        promptData.previousError = previousError;
        const userPrompt = PROMPTS.ARGUMENTS.buildUserPrompt(promptData);
        const rawJson = await this.dispatchPrompt(
          PROMPTS.ARGUMENTS.SYSTEM,
          userPrompt,
          true,
          1024,
          { stage: "arguments", thinking: false, signal }
        );

        const parsed = this.safeJsonParse(rawJson);

        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) {
            if (!required.includes(key)) {
              if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
                delete parsed[key];
              }
            }
          }

          const missing = required.filter((r) => parsed[r] === undefined);
          if (missing.length === 0) {
            return parsed;
          }
          previousError = `Faltan campos requeridos: ${missing.join(", ")}`;
        } else {
          console.error(`[Qwen arguments] Fallo de parseo JSON. Raw (primeros 300 chars): ${rawJson.slice(0, 300)}`);
          previousError = `La respuesta no es un objeto JSON válido`;
        }

        attempts++;
        if (attempts > MAX_ARG_RETRIES) {
          throw new LLMValidationError(
            `Fallo de argumentos para '${targetTool.name}' tras ${MAX_ARG_RETRIES} reintentos: ${previousError}`
          );
        }
        console.warn(`[Qwen] Reintento de argumentos (${attempts}/${MAX_ARG_RETRIES}) para '${targetTool.name}': ${previousError}`);
      }

      throw new LLMValidationError(`Fallo no recuperable de argumentos para '${targetTool.name}'.`);
    });
  }

  /**
   * Etapa 5B: Análisis del Fallo y Escalación (§4, §10.6)
   */
  async escalate(
    data: EscalationPromptData,
    signal?: AbortSignal
  ): Promise<EscalationResponse> {
    return await this.executeStage("escalate", async () => {
      const userPrompt = PROMPTS.ESCALATION.buildUserPrompt(data);
      const rawJson = await this.dispatchPrompt(
        PROMPTS.ESCALATION.SYSTEM,
        userPrompt,
        true,
        500,
        { stage: "escalate", signal }
      );

      const parsed = this.safeJsonParse<any>(rawJson);

      if (!parsed || (parsed.action !== "switch_mcp" && parsed.action !== "abort")) {
        console.error(`[Qwen escalate] Fallo de parseo o acción no reconocida. Raw (primeros 300 chars): ${rawJson.slice(0, 300)}`);
        return {
          action: "abort",
          reason: "Análisis de fallo de Qwen no devolvió una acción válida.",
        };
      }

      const validMcp = isStepRoute(parsed.mcp) ? parsed.mcp : undefined;

      return {
        action: parsed.action,
        mcp: validMcp,
        reason: parsed.reason || "Sin detalle.",
      };
    });
  }

  /**
   * Etapa 6: Respuesta final libre (§4, §10.6)
   */
  async generateFinalResponse(
    data: FinalResponsePromptData,
    signal?: AbortSignal
  ): Promise<string> {
    return await this.executeStage("generateFinalResponse", async () => {
      const userPrompt = PROMPTS.FINAL_RESPONSE.buildUserPrompt(data);
      const isThinking = ConfigManager.getConfig().thinking;

      try {
        const rawText = await this.dispatchPrompt(
          PROMPTS.FINAL_RESPONSE.SYSTEM,
          userPrompt,
          false,
          1500,
          { stage: "final_response", signal }
        );
        
        const thoughtMatch = rawText.match(/<think>([\s\S]*?)<\/think>/i);
        const thoughtText = thoughtMatch ? thoughtMatch[1].trim() : "";
        const outsideText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

        // Si outsideText quedó vacío o solo una frase genérica de tarea completada, pero thoughtText contiene la respuesta real:
        if (!outsideText || (outsideText.length < 90 && /tarea\s+(concluida|completada|finalizada|terminada)/i.test(outsideText))) {
          if (thoughtText && thoughtText.length > outsideText.length) {
            console.log(`[generateFinalResponse] Priorizando contenido sustantivo de bloque <think> (${thoughtText.length} chars).`);
            return thoughtText;
          }
        }

        const candidate = outsideText || thoughtText || rawText.trim();
        if (candidate.length < 90 && /tarea\s+(concluida|completada|finalizada|terminada)/i.test(candidate) && thoughtText) {
          return thoughtText;
        }

        return candidate;
      } catch (err: any) {
        // Si falló por timeout o error mientras el modo pensamiento estaba activo,
        // intentamos un reintento rápido con thinking=false para garantizar que el usuario reciba su respuesta sustantiva.
        if (isThinking && !signal?.aborted) {
          console.warn(`[generateFinalResponse] Falló con modo pensamiento activo (${err?.message || err}). Reintentando con thinking=false...`);
          try {
            const fallbackText = await this.dispatchPrompt(
              PROMPTS.FINAL_RESPONSE.SYSTEM,
              userPrompt,
              false,
              1000,
              { stage: "final_response_fallback", thinking: false, signal }
            );
            const cleanFallback = fallbackText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
            if (cleanFallback) {
              return cleanFallback;
            }
          } catch (retryErr: any) {
            console.error(`[generateFinalResponse] Reintento rápido también falló:`, retryErr?.message || retryErr);
          }
        }
        throw err;
      }
    });
  }

  /**
   * Modo PLAN: Planificación Inicial con Structured Outputs (§9.1, §3.2.3, §3.2.4)
   */
  async generatePlan(
    userMessage: string,
    scratchpadOrChat?: Scratchpad | string,
    signal?: AbortSignal,
    compactCatalog?: string,
    modificationFeedback?: string,
    existingPlanSummary?: string
  ): Promise<Plan> {
    return await this.executeStage("generatePlan", async () => {
      const chatContext = typeof scratchpadOrChat === "string" ? scratchpadOrChat : undefined;
      const catalog = compactCatalog || buildCompactCatalog();
      const userPrompt = PROMPTS.PLAN.buildUserPrompt(
        userMessage,
        chatContext,
        catalog,
        modificationFeedback,
        existingPlanSummary
      );

      const rawJson = await this.dispatchPrompt(
        PROMPTS.PLAN.SYSTEM,
        userPrompt,
        true,
        1500,
        {
          stage: "plan",
          signal,
          schema: PLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
        }
      );

      const parsed = this.safeJsonParse<any>(rawJson);

      if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        console.error(`[Qwen plan] Fallo de parseo de plan. Raw (primeros 300 chars): ${rawJson.slice(0, 300)}`);
        throw new LLMValidationError("Qwen 3.5 9B generó un plan inválido: falta 'steps'.");
      }

      const steps = parsed.steps.slice(0, MAX_STEPS).map((s: any, idx: number) => {
        const rawRoute = s.suggested_mcp || s.route;
        const safeRoute: StepRoute = isStepRoute(rawRoute) ? rawRoute : "desktop_commander";

        return {
          id: s.id || `s${idx + 1}`,
          goal: s.goal || s.instruction || `Paso ${idx + 1}`,
          instruction: s.goal || s.instruction || `Paso ${idx + 1}`,
          suggested_mcp: safeRoute,
          route: safeRoute,
          expected_outcome: s.expected_outcome || s.expectedOutcome || "Resultado completado",
          expectedOutcome: s.expected_outcome || s.expectedOutcome || "Resultado completado",
          dependencies: Array.isArray(s.dependencies) ? s.dependencies : undefined,
          candidate_tools: Array.isArray(s.candidate_tools) ? s.candidate_tools : undefined,
        };
      });

      return {
        objective: parsed.objective || userMessage,
        steps,
      };
    });
  }

  /**
   * Modo PLAN: Replan Localizado con Structured Outputs (§9.4, §3.2.6)
   */
  async replan(
    data: ReplanPromptData,
    signal?: AbortSignal
  ): Promise<{ action?: "abort"; reason?: string; plan?: Plan }> {
    return await this.executeStage("replan", async () => {
      const userPrompt = PROMPTS.REPLAN.buildUserPrompt(data);

      const rawJson = await this.dispatchPrompt(
        PROMPTS.REPLAN.SYSTEM,
        userPrompt,
        true,
        1500,
        {
          stage: "replan",
          signal,
          schema: REPLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
        }
      );

      const parsed = this.safeJsonParse<any>(rawJson);

      if (!parsed) {
        console.error(`[Qwen replan] Fallo de parseo de replan. Raw (primeros 300 chars): ${rawJson.slice(0, 300)}`);
      }

      if (parsed?.action === "abort") {
        return { action: "abort", reason: parsed.reason || "Replan decidió abortar." };
      }

      if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        throw new LLMValidationError("Replan no produjo pasos válidos.");
      }

      const steps = parsed.steps.slice(0, MAX_STEPS).map((s: any, idx: number) => {
        const rawRoute = s.suggested_mcp || s.route;
        const safeRoute: StepRoute = isStepRoute(rawRoute) ? rawRoute : "desktop_commander";

        return {
          id: s.id || `s${data.nextStepNumber + idx}`,
          goal: s.goal || s.instruction || "Paso",
          instruction: s.goal || s.instruction || "Paso",
          suggested_mcp: safeRoute,
          route: safeRoute,
          expected_outcome: s.expected_outcome || s.expectedOutcome || "Completado",
          expectedOutcome: s.expected_outcome || s.expectedOutcome || "Completado",
          dependencies: Array.isArray(s.dependencies) ? s.dependencies : undefined,
          candidate_tools: Array.isArray(s.candidate_tools) ? s.candidate_tools : undefined,
        };
      });

      return {
        plan: {
          objective: parsed.objective || data.goal,
          steps,
        },
      };
    });
  }

  /**
   * Fase 3B: Verificación semántica de etapa frente a objetivo observable (§3.2.6)
   */
  async verifyStage(
    data: StageVerificationPromptData,
    signal?: AbortSignal
  ): Promise<StageVerificationResult> {
    return await this.executeStage("verifyStage", async () => {
      const userPrompt = PROMPTS.STAGE_VERIFICATION.buildUserPrompt(data);

      const rawJson = await this.dispatchPrompt(
        PROMPTS.STAGE_VERIFICATION.SYSTEM,
        userPrompt,
        true,
        1000,
        {
          stage: "verify_stage",
          signal,
          schema: STAGE_VERIFICATION_JSON_SCHEMA as unknown as Record<string, unknown>,
        }
      );

      const parsed = this.safeJsonParse<any>(rawJson);
      if (!parsed || !parsed.status) {
        console.warn(`[Qwen verifyStage] Respuesta no parseable como JSON estricto. Raw: ${rawJson.slice(0, 200)}`);
        if (data.eosOk && data.eosCumple) {
          return {
            status: "completed",
            reason: "Verificación validada por concordancia de señales factuales.",
          };
        }
        return {
          status: "recoverable_deviation",
          reason: "Fallo al evaluar cumplimiento de etapa; requiere revisión de plan.",
        };
      }

      const validStatuses: StageVerificationResult["status"][] = [
        "completed",
        "recoverable_deviation",
        "insufficient_info",
        "unrecoverable_blocked",
      ];
      const status = validStatuses.includes(parsed.status) ? parsed.status : "recoverable_deviation";

      return {
        status,
        reason: parsed.reason || "Sin detalle.",
        questionForUser: parsed.question_for_user || undefined,
      };
    });
  }

  /**
   * Legacy chat response helper for transition
   */
  async generateChatResponse(instruction: string, _scratchpad?: any): Promise<string> {
    return await this.generateFinalResponse({
      goal: instruction,
      logLines: [],
      facts: {},
      failLines: [],
      evidenceSummaries: [],
    });
  }

  /**
   * Synthesize final response wrapper for backward compatibility
   */
  async synthesizeFinalResponse(
    taskMessage: string,
    steps: Step[],
    scratchpad: Scratchpad,
    evidenceList: Evidence[]
  ): Promise<string> {
    return await this.generateFinalResponse({
      goal: taskMessage,
      logLines: steps.map((s, i) => `${i + 1}|${s.tool || s.route}|${s.state}|${s.evidence?.summary || ''}`),
      facts: this.scratchpadToFacts(scratchpad),
      failLines: steps.filter((s) => s.error).map((s) => `${s.tool || s.route} -> ${s.error}`),
      evidenceSummaries: evidenceList.map((e) => e.summary || "").filter(Boolean),
    });
  }
}