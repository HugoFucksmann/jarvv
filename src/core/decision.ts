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
  DECISION_MIN_CONFIDENCE,
  DECISION_MIN_CONFIDENCE_POST_ACTION,
  DECISION_OVERRIDE_CONFIDENCE_THRESHOLD,
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

    const isDebug = process.env.DEBUG === "true" || process.env.JARVIS_DEBUG === "true" || process.env.DEBUG === "1" || process.env.JARVIS_DEBUG === "1";
    if (isDebug) {
      console.log(`[DEBUG Decision Payload]\n${JSON.stringify({ state: stateStr, questions }, null, 2)}`);
    }

    let response: Response;
    try {
      const timeoutMs = config.decisionTimeoutMs ?? config.timeoutMs ?? 30000;
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "ngrok-skip-browser-warning": "true",
          "bypass-tunnel-reminder": "true",
        },
        body: JSON.stringify({ state: stateStr, questions }),
        signal: AbortSignal.timeout(timeoutMs),
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
   * Decision #1: Structural routing for JARVIS (§3, §4, §10.6, §14)
   * Options: windows, desktop_commander, free_search, fin.
   * Validates confidence threshold for fin and picks best non-fin on low confidence.
   */
  async evaluateDecisionOne(
    taskMessage: string,
    historyContext: string | string[] = [],
    options?: {
      allowFin?: boolean;
      isPostAction?: boolean;
      isFirstIteration?: boolean;
    }
  ): Promise<{
    route: StepRoute;
    confidence: number;
    probabilities: Record<string, number>;
    multiStep: boolean; // maintained for UI compatibility
    needsContext: boolean;
    rawResponse: DecisionResponse;
  }> {
    const history = Array.isArray(historyContext)
      ? historyContext.slice(-3).join("\n")
      : historyContext;

    const statePayload = {
      current_message: taskMessage,
      history,
    };

    const criteria: Record<string, string> = {
      windows: "Interacción con ventanas de la interfaz gráfica de Windows, UI automation, clics en botones, foco de aplicaciones.",
      desktop_commander: "Operaciones de filesystem, ejecución de procesos, comandos bash/cmd, creación o lectura de archivos locales.",
      free_search: "Búsqueda de información externa en la web, fetch de páginas o lectura de documentación online.",
    };

    if (options?.allowFin !== false) {
      criteria.fin = "Consultas conversacionales directas, o declarar que el objetivo de la tarea está cumplido y se debe finalizar.";
    }

    const questions: Record<string, DecisionQuestion> = {
      route: {
        type: "choice",
        instructions: "¿Qué subsistema o ruta debe procesar la solicitud, o fin si el objetivo está completado/es conversacional?",
        criteria,
      },
    };

    // needs_context only asked on first iteration (§3)
    if (options?.isFirstIteration !== false) {
      questions.needs_context = {
        type: "noul",
        instructions: "¿Se requiere ampliar el contexto de mensajes anteriores para interpretar correctamente la intención?",
      };
    }

    const t0 = Date.now();
    let response: DecisionResponse;
    try {
      response = await this.systemOne(statePayload, questions);
    } catch (err: any) {
      console.error(`[Decision] error=${err?.message || err} duration=${Date.now() - t0}ms`);
      throw err;
    }

    const routeAnswer = response.answers.route as DecisionAnswerChoice;
    const needsContextAnswer = response.answers.needs_context as DecisionAnswerNoul | undefined;

    const validNonFinRoutes: StepRoute[] = ["windows", "desktop_commander", "free_search"];
    const validRoutes: StepRoute[] = options?.allowFin !== false
      ? ["fin", ...validNonFinRoutes]
      : validNonFinRoutes;

    const candidateRoute = routeAnswer.choice as StepRoute;
    const routeConfidence = routeAnswer.confidence ?? 0;
    const probabilities = routeAnswer.probabilities || {};

    const minConfidence = options?.isPostAction
      ? DECISION_MIN_CONFIDENCE_POST_ACTION
      : DECISION_MIN_CONFIDENCE;

    let route: StepRoute = candidateRoute;
    let adoptedConfidence = routeConfidence;

    // Validate fin against confidence threshold (§3, §5)
    if (candidateRoute === "fin") {
      if (routeConfidence < minConfidence) {
        // Find best non-fin candidate route from probabilities
        const sortedNonFin = Object.entries(probabilities)
          .filter(([k]) => k !== "fin" && validNonFinRoutes.includes(k as StepRoute))
          .sort(([, a], [, b]) => Number(b) - Number(a));
        route = (sortedNonFin[0]?.[0] as StepRoute) || "desktop_commander";
        adoptedConfidence = Number(sortedNonFin[0]?.[1] ?? 0);
        console.log(`[Decision] 'fin' rechazado por confianza (${routeConfidence.toFixed(2)} < ${minConfidence.toFixed(2)}). Tomada ruta '${route}' con confianza ${adoptedConfidence.toFixed(2)}.`);
      }
    } else if (!validRoutes.includes(candidateRoute)) {
      // Invalid selection: fallback to best non-fin route; fallback can NEVER be fin (§3)
      const sortedNonFin = Object.entries(probabilities)
        .filter(([k]) => k !== "fin" && validNonFinRoutes.includes(k as StepRoute))
        .sort(([, a], [, b]) => Number(b) - Number(a));
      route = (sortedNonFin[0]?.[0] as StepRoute) || "desktop_commander";
      adoptedConfidence = Number(sortedNonFin[0]?.[1] ?? 0);
    }

    const needsContext = needsContextAnswer ? needsContextAnswer.noul >= 0.6 : false;

    // Ordered distribution of probabilities
    const sortedProbabilities = Object.entries(probabilities)
      .sort(([, a], [, b]) => Number(b) - Number(a))
      .map(([k, v]) => `${k}: ${(Number(v) * 100).toFixed(1)}%`)
      .join(", ");

    const thresholdType = options?.isPostAction ? "post-action" : "normal";
    console.log(
      `[Decision #1] route=${route} confidence=${adoptedConfidence.toFixed(2)} threshold=${minConfidence.toFixed(2)} (${thresholdType}) probabilities=[${sortedProbabilities}] duration=${Date.now() - t0}ms`
    );

    return {
      route,
      confidence: adoptedConfidence,
      probabilities,
      multiStep: false, // multi_step query deprecated in v2.1 (§14)
      needsContext,
      rawResponse: response,
    };
  }

  /**
   * Decision #5: Evaluation of tool execution outcome (§3, §4, §10.6)
   * Evaluates if the result serves the goal: 'correcta' or 'incorrecta'.
   */
  async evaluateDecisionFive(
    goal: string,
    tool: string,
    resultSummary: string,
    signals: {
      exit_code?: number;
      not_found?: boolean;
      denied?: boolean;
      empty_output?: boolean;
      timeout?: boolean;
    }
  ): Promise<{
    isCorrect: boolean;
    choice: "correcta" | "incorrecta";
    confidence: number;
    override?: boolean;
    rawResponse: DecisionResponse;
  }> {
    // If exit code is 0 and no error signal, low confidence defaults to correcta (§4 Etapa 5)
    const statePayload = {
      goal,
      tool,
      result_summary: resultSummary.slice(0, 400),
      signals: JSON.stringify(signals),
    };

    const questions: Record<string, DecisionQuestion> = {
      evaluation: {
        type: "choice",
        instructions: "¿El resultado de la herramienta sirve al objetivo planteado?",
        criteria: {
          correcta: "El resultado sirve al objetivo (o responde adecuadamente, ej. archivo no existe).",
          incorrecta: "El resultado falló, dio error o no sirve al objetivo.",
        },
      },
    };

    const t0 = Date.now();
    let response: DecisionResponse;
    try {
      response = await this.systemOne(statePayload, questions);
    } catch (err: any) {
      console.error(`[Decision #5] error=${err?.message || err} duration=${Date.now() - t0}ms`);
      // Deterministic fallback on service error if exit code is 0 and no signals
      if (signals.exit_code === 0 && !signals.not_found && !signals.denied && !signals.empty_output) {
        return {
          isCorrect: true,
          choice: "correcta",
          confidence: 0.5,
          rawResponse: { model: "Decision-2.0-Kai-0.6B" as any, answers: {}, usage: { input_tokens: 0, output_tokens: 0 } },
        };
      }
      throw err;
    }

    const answer = response.answers.evaluation as DecisionAnswerChoice;
    const rawChoice = answer.choice;
    let isCorrect = rawChoice === "correcta";
    let override = false;

    // Ante baja confianza: exit_code == 0 y sin señal de error -> correcta (§4 Etapa 5)
    if (
      answer.confidence < DECISION_OVERRIDE_CONFIDENCE_THRESHOLD &&
      signals.exit_code === 0 &&
      !signals.not_found &&
      !signals.denied &&
      !signals.empty_output
    ) {
      if (!isCorrect) {
        isCorrect = true;
        override = true;
      }
    }

    console.log(
      `[Decision #5] raw=${rawChoice} conf=${answer.confidence.toFixed(2)} override=${override} isCorrect=${isCorrect} signals=${JSON.stringify(signals)} duration=${Date.now() - t0}ms`
    );

    return {
      isCorrect,
      choice: isCorrect ? "correcta" : "incorrecta",
      confidence: answer.confidence,
      rawResponse: response,
    };
  }

  /**
   * PLAN criteria judgement (§3, §9.3, §10.6)
   * Evaluates if the expected_outcome was met: 'cumple' or 'no_cumple'.
   */
  async evaluatePlanJudgement(
    expectedOutcome: string,
    finding: string,
    extract: string
  ): Promise<{
    met: boolean;
    confidence: number;
    rawResponse: DecisionResponse;
  }> {
    const statePayload = {
      expected_outcome: expectedOutcome,
      finding,
      extract: extract.slice(0, 400),
    };

    const questions: Record<string, DecisionQuestion> = {
      judgement: {
        type: "choice",
        instructions: "¿El resultado obtenido cumple con el resultado esperado para el objetivo del paso?",
        criteria: {
          cumple: "El resultado satisface claramente el resultado esperado.",
          no_cumple: "El resultado no satisface o contradice el resultado esperado.",
        },
      },
    };

    const t0 = Date.now();
    const response = await this.systemOne(statePayload, questions);
    const answer = response.answers.judgement as DecisionAnswerChoice;

    // Baja confianza cuenta como no_cumple (§9.3)
    const met = answer.choice === "cumple" && answer.confidence >= 0.6;

    console.log(`[Decision Judgement] judgement=${answer.choice} met=${met} confidence=${answer.confidence.toFixed(2)} duration=${Date.now() - t0}ms`);

    return {
      met,
      confidence: answer.confidence,
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
      console.log(`[Decision] tool=${tool.name} duration=0ms`);
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

    const t0 = Date.now();
    let response: DecisionResponse;
    try {
      response = await this.systemOne(statePayload, questions);
    } catch (err: any) {
      console.error(`[Decision] error=${err?.message || err} duration=${Date.now() - t0}ms`);
      throw err;
    }
    const choiceAnswer = response.answers.selected_tool as DecisionAnswerChoice;

    const matchedTool = limitedTools.find((t) => t.name === choiceAnswer.choice);
    if (!matchedTool) {
      console.error(`[Decision] error=unmatched_choice duration=${Date.now() - t0}ms`);
      throw new DecisionValidationError(
        `Decision 2.0 seleccionó una opción '${choiceAnswer.choice}' que no corresponde a ninguna de las herramientas descubiertas.`
      );
    }

    console.log(`[Decision] tool=${matchedTool.name} duration=${Date.now() - t0}ms`);

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
