/**
 * Qwen 3.5 9B — Real HTTP Client Adapter (Primary Reasoner & Language Engine)
 * 
 * Rules:
 * - REAL HTTP integration against configured Qwen 3.5 9B endpoint (ngrok URL on user's PC).
 * - NO regex heuristics, NO hardcoded plans, NO fake responses.
 * - Core depends on this client via ILLMClient interface.
 * - If Qwen 3.5 9B endpoint is unconfigured or unreachable, raises explicit LLMServiceUnavailableError.
 * - Enforces schema validation on generated arguments and plans.
 */

import {
  Step,
  MCPTool,
  Plan,
  Scratchpad,
  Evidence,
  MAX_STEPS,
} from "../types.ts";
import { ConfigManager } from "../config.ts";
import { PROMPTS } from "./prompts.ts";

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

export interface ILLMClient {
  generateArguments(
    step: Step,
    tool: MCPTool,
    scratchpad: Scratchpad,
    context: string
  ): Promise<Record<string, unknown>>;

  generatePlan(
    userMessage: string,
    scratchpad: Scratchpad
  ): Promise<Plan>;

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
   * Helper to dispatch inference requests to the configured Qwen HTTP endpoint.
   */
  private async dispatchPrompt(
    systemPrompt: string,
    userPrompt: string,
    expectJson = true,
    maxTokens?: number
  ): Promise<string> {
    const config = ConfigManager.getConfig();
    const endpointUrl = config.qwenUrl?.trim();

    if (!endpointUrl) {
      throw new LLMServiceUnavailableError(
        "La URL del servicio Qwen 3.5 9B no está configurada. Configure la URL de ngrok/HTTP en la barra de configuración."
      );
    }

    // Determine normalized URL endpoint
    let url = endpointUrl;
    if (url.endsWith("/")) url = url.slice(0, -1);
    if (!url.endsWith("/v1/chat/completions") && !url.endsWith("/generate") && !url.endsWith("/api/chat")) {
      // Default to /v1/chat/completions or /generate
      url = `${url}/v1/chat/completions`;
    }

    let response: Response;
    const modelName = config.qwenModel?.trim();
    const isThinking = Boolean(config.thinking);

    const bodyPayload: any = {
      ...(modelName ? { model: modelName } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      stream: false,
      reasoning_effort: isThinking ? "low" : "none",
    };

    if (maxTokens) {
      bodyPayload.max_tokens = maxTokens;
      bodyPayload.options = {
        ...(bodyPayload.options || {}),
        num_predict: maxTokens,
      };
    }

    if (expectJson) {
      bodyPayload.response_format = { type: "json_object" };
      bodyPayload.format = "json"; // Native Ollama format parameter
    }

    const timeoutMs = config.qwenTimeoutMs ?? config.timeoutMs ?? 60000;

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
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      if (err.name === "TimeoutError") {
        throw new LLMServiceUnavailableError(`Timeout al conectar con Qwen 3.5 9B en ${url}`, err);
      }
      throw new LLMServiceUnavailableError(
        `No fue posible conectar con el servicio Qwen 3.5 9B en ${url}. Verifique que el servidor (Ollama/vLLM) y ngrok estén activos en su PC.`,
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
    } catch (err) {
      throw new LLMValidationError("La respuesta de Qwen 3.5 9B no contiene un cuerpo JSON legible.");
    }

    const firstChoice = data.choices?.[0];
    const messageObj = firstChoice?.message || data.message;

    // Logging de diagnóstico de reasoning si está presente (sin usarlo como respuesta visible)
    const reasoningTrace =
      messageObj?.reasoning ||
      messageObj?.reasoning_content ||
      messageObj?.thinking ||
      data.thinking;
    if (reasoningTrace && typeof reasoningTrace === "string") {
      const preview = reasoningTrace.replace(/\r?\n/g, " ").slice(0, 120);
      console.log(`[Qwen] Reasoning trace detected (${reasoningTrace.length} chars): ${preview}...`);
    }

    // La respuesta visible al usuario debe ser el contenido final (message.content, data.response o firstChoice.text)
    // NO utilizar message.reasoning / reasoning_content / thinking como respuesta final
    let content: string | undefined;

    if (typeof messageObj?.content === "string" && messageObj.content.trim()) {
      content = messageObj.content;
    } else if (typeof data.response === "string" && data.response.trim()) {
      content = data.response;
    } else if (typeof firstChoice?.text === "string" && firstChoice.text.trim()) {
      content = firstChoice.text;
    }

    if (!content || typeof content !== "string" || !content.trim()) {
      console.error("[Qwen] Raw response keys / sample:", JSON.stringify(data).slice(0, 300));
      throw new LLMValidationError("Respuesta de Qwen 3.5 9B vacía o con estructura no reconocida.");
    }

    return content.trim();
  }

  /**
   * Generates arguments for a selected tool, conforming strictly to its inputSchema.
   */
  async generateArguments(
    step: Step,
    tool: MCPTool,
    scratchpad: Scratchpad,
    context: string
  ): Promise<Record<string, unknown>> {
    return await this.executeStage("generateArguments", async () => {
      const systemPrompt = PROMPTS.ARGUMENTS.SYSTEM;

      // Prune excessive scratchpad data to respect context boundary (§4.13, §21)
      const compactScratchpad: Record<string, unknown> = { ...scratchpad };
      if (typeof compactScratchpad.text === "string" && compactScratchpad.text.length > 500) {
        compactScratchpad.text = `${compactScratchpad.text.substring(0, 500)}... [truncado]`;
      }
      if (Array.isArray(compactScratchpad.search_results) && compactScratchpad.search_results.length > 3) {
        compactScratchpad.search_results = compactScratchpad.search_results.slice(0, 3);
      }

      const userPrompt = PROMPTS.ARGUMENTS.buildUserPrompt(step, tool, compactScratchpad, context);

      const rawJson = await this.dispatchPrompt(systemPrompt, userPrompt, true, 1024);
      let parsed: any;
      try {
        parsed = JSON.parse(rawJson);
      } catch (e) {
        // Clean possible markdown code fences if model returned them
        const match = rawJson.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch { }
        }
      }

      if (!parsed || typeof parsed !== "object") {
        throw new LLMValidationError(`Qwen 3.5 9B generó argumentos inválidos (no es un objeto JSON): "${rawJson.substring(0, 100)}"`);
      }

      // Validate required properties against tool.inputSchema
      const required = (tool.inputSchema?.required as string[]) || [];
      for (const req of required) {
        if (parsed[req] === undefined) {
          throw new LLMValidationError(
            `Argumentos generados por Qwen 3.5 9B omiten el campo obligatorio '${req}' requerido por el schema de '${tool.name}'.`
          );
        }
      }

      return parsed;
    });
  }

  /**
   * Generates a multi-step plan when mode is PLAN or multi_step is detected.
   * Max 15 steps. Strictly adheres to Plan schema.
   */
  async generatePlan(
    userMessage: string,
    scratchpad: Scratchpad
  ): Promise<Plan> {
    return await this.executeStage("generatePlan", async () => {
      const systemPrompt = PROMPTS.PLAN.SYSTEM;
      const userPrompt = PROMPTS.PLAN.buildUserPrompt(userMessage, scratchpad);

      const rawJson = await this.dispatchPrompt(systemPrompt, userPrompt, true, 1500);
      let parsed: any;
      try {
        parsed = JSON.parse(rawJson);
      } catch (e) {
        const match = rawJson.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch { }
        }
      }

      if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        const preview = (rawJson || "").replace(/\r?\n\s*/g, " ").slice(0, 160);
        const keys = parsed && typeof parsed === "object" ? (Array.isArray(parsed) ? `array[${parsed.length}]` : Object.keys(parsed).join(",")) : typeof parsed;
        console.error(`[Qwen] generatePlan preview="${preview}" keys=${keys}`);
        throw new LLMValidationError("Qwen 3.5 9B generó un plan inválido: falta la clave 'steps' o está vacía.");
      }

      if (parsed.steps.length > MAX_STEPS) {
        parsed.steps = parsed.steps.slice(0, MAX_STEPS);
      }

      for (let i = 0; i < parsed.steps.length; i++) {
        const s = parsed.steps[i];
        if (!s.id || !s.route || !s.instruction) {
          throw new LLMValidationError(
            `Paso #${i + 1} del plan generado por Qwen 3.5 9B no cumple con los campos requeridos (id, route, instruction).`
          );
        }
      }

      return parsed as Plan;
    });
  }

  /**
   * Generates a conversational response for route='chat' without executing tools.
   */
  async generateChatResponse(
    instruction: string,
    scratchpad: Scratchpad
  ): Promise<string> {
    return await this.executeStage("generateChatResponse", async () => {
      const systemPrompt = PROMPTS.CHAT.SYSTEM;
      const userPrompt = PROMPTS.CHAT.buildUserPrompt(instruction, scratchpad);

      return await this.dispatchPrompt(systemPrompt, userPrompt, false, 1024);
    });
  }

  /**
   * Synthesizes the final response for the user after task completion.
   */
  async synthesizeFinalResponse(
    taskMessage: string,
    steps: Step[],
    scratchpad: Scratchpad,
    evidenceList: Evidence[]
  ): Promise<string> {
    return await this.executeStage("synthesizeFinalResponse", async () => {
      const systemPrompt = PROMPTS.SYNTHESIS.SYSTEM;

      const summaryPayload = {
        tarea: taskMessage,
        pasos_completados: steps.map((s) => ({
          id: s.id,
          route: s.route,
          tool: s.tool,
          estado: s.state,
          verificacion: s.verification,
        })),
        evidencia: evidenceList.map((e) => e.summary),
        scratchpad,
      };

      const userPrompt = PROMPTS.SYNTHESIS.buildUserPrompt(summaryPayload);

      return await this.dispatchPrompt(systemPrompt, userPrompt, false, 1500);
    });
  }
}
