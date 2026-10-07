/**
 * Decision 2.0 — Real HTTP Client Adapter
 * Model: vllm-sr/Decision-2.0-Kai-0.6B
 * 
 * Rules:
 * - REAL HTTP integration against configured URL (e.g. ngrok endpoint).
 * - NO heuristics, NO keyword simulation.
 * - If service is unconfigured or unreachable, raises explicit controlled DecisionServiceUnavailableError.
 * - Adheres strictly to official contract:
 *   - system_one(state, questions)
 *   - types: choice (2-255), noul, score (2-10)
 *   - 8192 tokens max context check
 */

import {
  DecisionQuestion,
  DecisionResponse,
  DecisionAnswer,
  DecisionAnswerChoice,
  DecisionAnswerNoul,
  StepRoute,
  MCPTool,
} from "./types.ts";
import { ConfigManager } from "./config.ts";

export class DecisionServiceUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(`[Decision 2.0 Unavailable] ${message}`);
    this.name = "DecisionServiceUnavailableError";
  }
}

export class DecisionValidationError extends Error {
  constructor(message: string) {
    super(`[Decision 2.0 Validation] ${message}`);
    this.name = "DecisionValidationError";
  }
}

export class Decision20Engine {
  /**
   * Invokes system_one on the real Decision 2.0 model endpoint.
   */
  async systemOne(
    state: string | Record<string, unknown>,
    questions: Record<string, DecisionQuestion>
  ): Promise<DecisionResponse> {
    const config = ConfigManager.getConfig();
    const endpointUrl = config.decisionUrl?.trim();

    if (!endpointUrl) {
      throw new DecisionServiceUnavailableError(
        "La URL de Decision 2.0 no está configurada. Configure la URL de ngrok/HTTP en la barra de configuración."
      );
    }

    const stateStr = typeof state === "string" ? state : JSON.stringify(state);

    // Verify context boundary (8192 tokens)
    const estimatedTokens = Math.ceil(stateStr.length / 3.5) + Object.keys(questions).length * 40;
    if (estimatedTokens > 8192) {
      throw new DecisionValidationError(
        `Desbordamiento de contexto en Decision 2.0: estimación de ${estimatedTokens} tokens supera el límite de 8.192 tokens.`
      );
    }

    const url = endpointUrl.endsWith("/v1/decide")
      ? endpointUrl
      : `${endpointUrl.replace(/\/+$/, "")}/v1/decide`;

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
        body: JSON.stringify({ state: stateStr, questions }),
        signal: AbortSignal.timeout(config.timeoutMs || 30000),
      });
    } catch (err: any) {
      if (err.name === "TimeoutError") {
        throw new DecisionServiceUnavailableError(`Timeout al conectar con Decision 2.0 en ${url}`, err);
      }
      throw new DecisionServiceUnavailableError(
        `No fue posible conectar con el servicio Decision 2.0 en ${url}. Verifique que el servicio y ngrok estén en ejecución en su PC.`,
        err
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new DecisionServiceUnavailableError(
        `Decision 2.0 HTTP error ${response.status} (${response.statusText}): ${errText}`
      );
    }

    let data: any;
    try {
      data = await response.json();
    } catch (err) {
      throw new DecisionValidationError("La respuesta de Decision 2.0 no es un JSON válido.");
    }

    // Validate response payload conforms strictly to Decision 2.0 contract
    this.validateResponse(data, questions);

    return data as DecisionResponse;
  }

  /**
   * Decision #1: Structural routing for JARVIS
   * Returns { route, multiStep, needsContext, rawResponse }
   */
  async evaluateDecisionOne(
    taskMessage: string,
    historyMessages: string[] = []
  ): Promise<{
    route: StepRoute;
    multiStep: boolean;
    needsContext: boolean;
    rawResponse: DecisionResponse;
  }> {
    const relevantHistory = historyMessages.slice(-2);
    const statePayload = {
      current_message: taskMessage,
      history: relevantHistory,
    };

    const questions: Record<string, DecisionQuestion> = {
      route: {
        type: "choice",
        instructions: "¿Qué subsistema o ruta debe procesar la solicitud?",
        criteria: {
          chat: "Consultas conversacionales directas, explicaciones, preguntas y respuestas sin interactuar con el SO ni la web.",
          windows: "Interacción con ventanas de la interfaz gráfica de Windows, UI automation, clics en botones, foco de aplicaciones.",
          desktop_commander: "Operaciones de filesystem, ejecución de procesos, comandos bash/cmd, creación o lectura de archivos locales.",
          free_search: "Búsqueda de información externa en la web, fetch de páginas o lectura de documentación online.",
        },
      },
      multi_step: {
        type: "noul",
        instructions: "¿Requiere esta solicitud una secuencia o plan de múltiples pasos para completarse?",
      },
      needs_context: {
        type: "noul",
        instructions: "¿Se requiere ampliar el contexto de mensajes anteriores para interpretar correctamente la intención?",
      },
    };

    const response = await this.systemOne(statePayload, questions);

    const routeAnswer = response.answers.route as DecisionAnswerChoice;
    const multiStepAnswer = response.answers.multi_step as DecisionAnswerNoul;
    const needsContextAnswer = response.answers.needs_context as DecisionAnswerNoul;

    const validRoutes: StepRoute[] = ["chat", "windows", "desktop_commander", "free_search"];
    const candidateRoute = routeAnswer.choice as StepRoute;
    const route = validRoutes.includes(candidateRoute) ? candidateRoute : "chat";
    const multiStep = multiStepAnswer.noul >= 0.5;
    const needsContext = needsContextAnswer.noul >= 0.6;

    return {
      route,
      multiStep,
      needsContext,
      rawResponse: response,
    };
  }

  /**
   * Decision #2: Tool selection within discovered tools of the active MCP
   */
  async evaluateDecisionTwo(
    instruction: string,
    discoveredTools: MCPTool[],
    scratchpadSummary?: string
  ): Promise<{
    selectedTool: MCPTool;
    choiceAnswer: DecisionAnswerChoice;
    rawResponse: DecisionResponse;
  }> {
    if (discoveredTools.length === 0) {
      throw new DecisionValidationError("Decision #2 falló: No se proporcionaron herramientas descubiertas.");
    }

    if (discoveredTools.length === 1) {
      const tool = discoveredTools[0];
      const answer: DecisionAnswerChoice = {
        type: "choice",
        choice: tool.name,
        probabilities: { [tool.name]: 1.0 },
        confidence: 1.0,
      };
      return {
        selectedTool: tool,
        choiceAnswer: answer,
        rawResponse: {
          model: "Decision-2.0-Kai-0.6B",
          answers: { selected_tool: answer },
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      };
    }

    // Contract limit: 2–255 options
    const limitedTools = discoveredTools.slice(0, 255);
    const criteria: Record<string, string> = {};
    for (const t of limitedTools) {
      criteria[t.name] = t.description || `Tool ${t.name}`;
    }

    const statePayload = {
      instruction,
      scratchpad_context: scratchpadSummary || "",
    };

    const questions: Record<string, DecisionQuestion> = {
      selected_tool: {
        type: "choice",
        instructions: "¿Cuál es la herramienta idónea para cumplir la instrucción dada?",
        criteria,
      },
    };

    const response = await this.systemOne(statePayload, questions);
    const choiceAnswer = response.answers.selected_tool as DecisionAnswerChoice;

    const matchedTool = limitedTools.find((t) => t.name === choiceAnswer.choice);
    if (!matchedTool) {
      throw new DecisionValidationError(
        `Decision 2.0 seleccionó una opción '${choiceAnswer.choice}' que no corresponde a ninguna de las herramientas descubiertas.`
      );
    }

    return {
      selectedTool: matchedTool,
      choiceAnswer,
      rawResponse: response,
    };
  }

  private validateResponse(data: any, expectedQuestions: Record<string, DecisionQuestion>): void {
    if (!data || typeof data !== "object") {
      throw new DecisionValidationError("La respuesta de Decision 2.0 debe ser un objeto JSON.");
    }

    // Support both standard { answers: { ... } } and direct answers map
    if (!data.answers && typeof data === "object") {
      const hasAnyQuestion = Object.keys(expectedQuestions).some((k) => k in data);
      if (hasAnyQuestion) {
        data.answers = { ...data };
      }
    }

    if (!data.answers || typeof data.answers !== "object") {
      throw new DecisionValidationError("La respuesta de Decision 2.0 no contiene la clave 'answers'.");
    }

    for (const [key, qDef] of Object.entries(expectedQuestions)) {
      const ans = data.answers[key] as DecisionAnswer;
      if (!ans) {
        throw new DecisionValidationError(
          `La respuesta de Decision 2.0 no incluye respuesta para la pregunta '${key}'.`
        );
      }

      if (ans.type !== qDef.type) {
        throw new DecisionValidationError(
          `Inconsistencia de tipo para pregunta '${key}': esperado '${qDef.type}', recibido '${ans.type}'.`
        );
      }

      if (qDef.type === "choice") {
        const choiceAns = ans as DecisionAnswerChoice;
        if (!choiceAns.choice || typeof choiceAns.choice !== "string") {
          throw new DecisionValidationError(`Respuesta choice para '${key}' no contiene un campo 'choice' válido.`);
        }
        if (!choiceAns.probabilities || typeof choiceAns.probabilities !== "object") {
          throw new DecisionValidationError(`Respuesta choice para '${key}' no contiene distribución 'probabilities'.`);
        }
        if (typeof choiceAns.confidence !== "number") {
          throw new DecisionValidationError(`Respuesta choice para '${key}' no contiene valor 'confidence' numérico.`);
        }
      } else if (qDef.type === "noul") {
        const noulAns = ans as DecisionAnswerNoul;
        if (typeof noulAns.noul !== "number" || noulAns.noul < 0 || noulAns.noul > 1) {
          throw new DecisionValidationError(`Respuesta noul para '${key}' debe ser un float en el rango [0.0, 1.0].`);
        }
      }
    }
  }
}
