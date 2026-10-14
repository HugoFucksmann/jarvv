/**
 * Decision 2.0 — Real HTTP Client Adapter
 * Model: vllm-sr/Decision-2.0-Eos-0.8B
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
import { DECISION_PROMPTS, Attempt } from "./reasoner/prompts.ts";

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

    // Diagnostic log: exact payload sent to Decision
    console.log(`[Decision → SEND] state=${JSON.stringify(stateStr).slice(0, 300)} questions=${JSON.stringify(questions)}`);

    const requestPayload = { state: stateStr, questions };
    const requestBody = JSON.stringify(requestPayload, null, 2);

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
        body: JSON.stringify(requestPayload),
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

    let rawOutput: string;
    let data: any;
    try {
      rawOutput = await response.text();
      data = JSON.parse(rawOutput);
    } catch (err) {
      throw new DecisionValidationError("La respuesta de Decision 2.0 no es un JSON válido.");
    }

    // Diagnostic log: raw response received from Decision
    console.log(`[Decision ← RECV] ${rawOutput}`);

    // Validate response payload conforms strictly to Decision 2.0 contract
    this.validateResponse(data, questions);

    data.rawInput = requestBody;
    data.rawOutput = rawOutput;

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
      /** Observación compacta del último resultado obtenido, para que D1 la vea. */
      lastResult?: string;
      /** Historial de acciones ya ejecutadas, para marcar rutas fallidas. */
      attempts?: Attempt[];
    }
  ): Promise<{
    route: StepRoute;
    confidence: number;
    probabilities: Record<string, number>;
    needsContext: boolean;
    rawResponse: DecisionResponse;
    rawInput: string;
    rawOutput: string;
  }> {
    const history = Array.isArray(historyContext)
      ? historyContext.slice(-3).join("\n")
      : historyContext;

    const { state: statePayload, questions } = DECISION_PROMPTS.buildDecisionOne({
      taskMessage,
      history,
      allowFin: options?.allowFin !== false,
      isFirstIteration: options?.isFirstIteration !== false,
      lastResult: options?.lastResult,
      attempts: options?.attempts,
    });

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

    let route: StepRoute;
    let adoptedConfidence = routeConfidence;

    // Resolución por mayor probabilidad (argmax) sin umbrales numéricos de corte (Fase 3, §4.2, §10)
    if (validRoutes.includes(candidateRoute)) {
      route = candidateRoute;
    } else {
      // Si la opción no pertenece a las rutas válidas, tomar la ruta válida con mayor probabilidad (argmax)
      const sortedValid = Object.entries(probabilities)
        .filter(([k]) => validRoutes.includes(k as StepRoute))
        .sort(([, a], [, b]) => Number(b) - Number(a));
      route = (sortedValid[0]?.[0] as StepRoute) || "desktop_commander";
      adoptedConfidence = Number(sortedValid[0]?.[1] ?? 1.0);
      console.warn(`[Decision #1] Opción '${candidateRoute}' no válida. Resuelto por argmax a '${route}' (${adoptedConfidence.toFixed(2)}).`);
    }

    // Argmax binario para necesidad de contexto (>= 0.5) sin umbrales arbitrarios
    const needsContext = needsContextAnswer ? needsContextAnswer.noul >= 0.5 : false;

    // Ordered distribution of probabilities
    const sortedProbabilities = Object.entries(probabilities)
      .sort(([, a], [, b]) => Number(b) - Number(a))
      .map(([k, v]) => `${k}: ${(Number(v) * 100).toFixed(1)}%`)
      .join(", ");

    console.log(
      `[Decision #1] route=${route} confidence=${adoptedConfidence.toFixed(2)} (argmax) probabilities=[${sortedProbabilities}] duration=${Date.now() - t0}ms`
    );

    return {
      route,
      confidence: adoptedConfidence,
      probabilities,
      needsContext,
      rawResponse: response,
      rawInput: response.rawInput || JSON.stringify({ state: statePayload, questions }, null, 2),
      rawOutput: response.rawOutput || JSON.stringify(response, null, 2),
    };
  }

  /**
   * Verificación factual a nivel de paso con Eos (Fase 3, §5)
   * Preguntas binarias noul sobre señales limpias (CLEAN): ok y cumple
   * Evaluación por mayor probabilidad (argmax: >= 0.5) sin umbrales arbitrarios.
   */
  async evaluateStepVerification(
    instruction: string,
    toolName: string,
    resultSummary: string,
    evidenceSummary?: string,
    expectedOutcome?: string
  ): Promise<{
    ok: boolean;
    cumple: boolean;
    okProbability: number;
    cumpleProbability: number;
    rawResponse: DecisionResponse;
    rawInput: string;
    rawOutput: string;
  }> {
    const { state: statePayload, questions } = DECISION_PROMPTS.buildStepVerification({
      instruction,
      toolName,
      resultSummary,
      evidenceSummary,
      expectedOutcome,
    });

    const t0 = Date.now();
    let response: DecisionResponse;
    try {
      response = await this.systemOne(statePayload, questions);
    } catch (err: any) {
      console.error(`[StepVerification] error=${err?.message || err} duration=${Date.now() - t0}ms`);
      throw err;
    }

    const okAns = response.answers.ok as DecisionAnswerNoul;
    const cumpleAns = response.answers.cumple as DecisionAnswerNoul;

    // Argmax binario: mayor probabilidad (>= 0.5) sin umbrales de corte arbitrarios (§4.2, §5)
    const ok = okAns ? okAns.noul >= 0.5 : false;
    const cumple = cumpleAns ? cumpleAns.noul >= 0.5 : false;

    console.log(
      `[StepVerification Eos] tool=${toolName} ok=${ok} (p=${okAns?.noul?.toFixed(2) ?? "N/A"}) cumple=${cumple} (p=${cumpleAns?.noul?.toFixed(2) ?? "N/A"}) duration=${Date.now() - t0}ms`
    );

    return {
      ok,
      cumple,
      okProbability: okAns?.noul ?? 0,
      cumpleProbability: cumpleAns?.noul ?? 0,
      rawResponse: response,
      rawInput: response.rawInput || JSON.stringify({ state: statePayload, questions }, null, 2),
      rawOutput: response.rawOutput || JSON.stringify(response, null, 2),
    };
  }

  /**
   * Decision #2: Tool selection within discovered tools of the active MCP
   */
  async evaluateDecisionTwo(
    instruction: string,
    discoveredTools: MCPTool[],
    scratchpadSummary?: string,
    attempts?: Attempt[]
  ): Promise<{
    selectedTool: MCPTool;
    choiceAnswer: DecisionAnswerChoice;
    rawResponse: DecisionResponse;
    rawInput: string;
    rawOutput: string;
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
      const mockRaw: DecisionResponse = {
        model: "Decision-2.0-Eos-0.8B",
        answers: { selected_tool: answer },
        usage: { input_tokens: 0, output_tokens: 0 },
      };
      const rawIn = JSON.stringify({ state: instruction, single_tool: tool.name }, null, 2);
      const rawOut = JSON.stringify(mockRaw, null, 2);
      return {
        selectedTool: tool,
        choiceAnswer: answer,
        rawResponse: {
          ...mockRaw,
          rawInput: rawIn,
          rawOutput: rawOut,
        },
        rawInput: rawIn,
        rawOutput: rawOut,
      };
    }

    // Contract limit: 2–255 options applied inside builder
    const { state: statePayload, questions } = DECISION_PROMPTS.buildDecisionTwo({
      instruction,
      scratchpadContext: scratchpadSummary || "",
      tools: discoveredTools,
      attempts,
    });
    const limitedTools = discoveredTools.slice(0, 255);

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
      rawInput: response.rawInput || JSON.stringify({ state: statePayload, questions }, null, 2),
      rawOutput: response.rawOutput || JSON.stringify(response, null, 2),
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
          choiceAns.probabilities = {};
        }
        if (typeof choiceAns.confidence !== "number") {
          choiceAns.confidence = (choiceAns.probabilities && typeof choiceAns.probabilities[choiceAns.choice] === "number")
            ? choiceAns.probabilities[choiceAns.choice]
            : 1.0;
        }
        if ("criteria" in qDef && qDef.criteria && typeof qDef.criteria === "object") {
          const validCriteriaKeys = Object.keys(qDef.criteria);
          if (!validCriteriaKeys.includes(choiceAns.choice)) {
            throw new DecisionValidationError(
              `Respuesta choice para '${key}' seleccionó '${choiceAns.choice}', que no coincide con ninguna opción permitida (${validCriteriaKeys.join(", ")}).`
            );
          }
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
