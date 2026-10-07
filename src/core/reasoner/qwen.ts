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
   * Helper to dispatch inference requests to the configured Qwen HTTP endpoint.
   */
  private async dispatchPrompt(systemPrompt: string, userPrompt: string, expectJson = true): Promise<string> {
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
    const bodyPayload: any = {
      ...(modelName ? { model: modelName } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      stream: false,
    };

    if (expectJson) {
      bodyPayload.response_format = { type: "json_object" };
      bodyPayload.format = "json"; // Native Ollama format parameter
    }

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
        signal: AbortSignal.timeout(config.timeoutMs || 30000),
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

    // Support standard OpenAI format ({ choices: [{ message: { content } }] }) or Ollama format ({ message: { content } })
    let content: string | undefined;
    if (data.choices?.[0]?.message?.content) {
      content = data.choices[0].message.content;
    } else if (data.message?.content) {
      content = data.message.content;
    } else if (data.response) {
      content = data.response;
    }

    if (!content || typeof content !== "string") {
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
    const systemPrompt = `Eres el generador de argumentos de JARVIS Core.
Tu única función es generar un objeto JSON válido con los argumentos para la herramienta indicada, cumpliendo estrictamente con su inputSchema.
NO agregues explicaciones, markdown adicional ni comentarios. Devuelve únicamente el objeto JSON con los campos requeridos.`;

    // Prune excessive scratchpad data to respect context boundary (§4.13, §21)
    const compactScratchpad: Record<string, unknown> = { ...scratchpad };
    if (typeof compactScratchpad.text === "string" && compactScratchpad.text.length > 500) {
      compactScratchpad.text = `${compactScratchpad.text.substring(0, 500)}... [truncado]`;
    }
    if (Array.isArray(compactScratchpad.search_results) && compactScratchpad.search_results.length > 3) {
      compactScratchpad.search_results = compactScratchpad.search_results.slice(0, 3);
    }

    const userPrompt = `Tool seleccionada: "${tool.name}"
Descripción de la tool: "${tool.description}"
Input Schema: ${JSON.stringify(tool.inputSchema)}
Instrucción del paso: "${step.instruction}"
Contexto de la tarea: "${context}"
Scratchpad actual: ${JSON.stringify(compactScratchpad)}

Genera los argumentos JSON para ejecutar la tool.`;

    const rawJson = await this.dispatchPrompt(systemPrompt, userPrompt, true);
    let parsed: any;
    try {
      parsed = JSON.parse(rawJson);
    } catch (e) {
      // Clean possible markdown code fences if model returned them
      const match = rawJson.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {}
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
  }

  /**
   * Generates a multi-step plan when mode is PLAN or multi_step is detected.
   * Max 15 steps. Strictly adheres to Plan schema.
   */
  async generatePlan(
    userMessage: string,
    scratchpad: Scratchpad
  ): Promise<Plan> {
    const systemPrompt = `Eres el planificador de JARVIS Core.
Tu objetivo es descomponer la solicitud del usuario en una secuencia ordenada de pasos deterministas.
Rutas disponibles: "chat", "windows", "desktop_commander", "free_search".
Reglas estrictas:
1. Máximo 15 pasos.
2. Cada paso debe tener la estructura: { "id": "step-1", "route": "...", "instruction": "..." }.
3. NO incluyas campos adicionales.
4. Devuelve ÚNICAMENTE un JSON con la estructura: { "steps": [ ... ] }.`;

    const userPrompt = `Solicitud del usuario: "${userMessage}"
Scratchpad actual: ${JSON.stringify(scratchpad)}

Genera el plan de ejecución en JSON:`;

    const rawJson = await this.dispatchPrompt(systemPrompt, userPrompt, true);
    let parsed: any;
    try {
      parsed = JSON.parse(rawJson);
    } catch (e) {
      const match = rawJson.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {}
      }
    }

    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
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
  }

  /**
   * Generates a conversational response for route='chat' without executing tools.
   */
  async generateChatResponse(
    instruction: string,
    scratchpad: Scratchpad
  ): Promise<string> {
    const systemPrompt = `Eres JARVIS Core (asistente de sistema).
Responde de forma concisa, precisa y profesional en español a la consulta o instrucción del usuario.
Usa los datos del Scratchpad si son relevantes. NO inventes hechos fuera del contexto del sistema.`;

    const userPrompt = `Instrucción: "${instruction}"
Datos de Scratchpad: ${JSON.stringify(scratchpad)}`;

    return await this.dispatchPrompt(systemPrompt, userPrompt, false);
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
    const systemPrompt = `Eres JARVIS Core sintetizando el resultado final de una tarea.
Resume en un párrafo claro y profesional qué acciones se completaron, qué evidencia se obtuvo y la conclusión para el usuario.
Menciona si hubo pasos no verificados o fallidos.`;

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

    const userPrompt = `Resumen de ejecución:
${JSON.stringify(summaryPayload, null, 2)}

Genera la respuesta final en español:`;

    return await this.dispatchPrompt(systemPrompt, userPrompt, false);
  }
}
