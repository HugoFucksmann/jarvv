/**
 * Decision 2.0 — Adaptador HTTP real
 * Motores soportados por JARVIS:
 *   - eos : FastAPI local (payload: state + questions → answers)
 *   - d3  : Ollama local (payload: model + state + questions → answers)
 *
 * - Integración HTTP real contra la URL configurada; sin simulaciones. Si el servicio no está configurado o no
 *   responde, lanza DecisionServiceUnavailableError.
 * - `chooseRoute` y `chooseTool` (contrato `IActionDecision`, engine/deps.ts) reciben el marco de `forRoute`, y `reviewArgs`
 *   (Decisión 3) el de `forReview`; los métodos
 *   `evaluateDecisionOne` y `evaluateDecisionTwo` del motor vigente no cambian.
 * - Tipos de pregunta implementados: `choice` y `noul`. El contrato también define `score`; no se usa ni se implementa.
 * - Validación de la respuesta en un solo punto (parseResponse); el resto del código confía en ella.
 * - Umbral de `noul`: se aprueba solo con probabilidad estrictamente mayor que 0.5 (ante ambigüedad, no se aprueba).
 * - Transporte (reintento único en red/503, timeout, cancelación): llmTransport.ts.
 */

import {
  type Attempt,
  type DecisionAnswer,
  type DecisionAnswerChoice,
  type DecisionAnswerNoul,
  type DecisionQuestion,
  type DecisionResponse,
  type DecisionOneResult,
  type DecisionTwoResult,
  type MCPTool,
  type StepRoute,
  type StepVerificationResult,
} from "./types.ts";
import type { IDecisionEngine } from "./engineDeps.ts";
import type {
  DecisionTrace,
  IActionDecision,
  ReviewDecision,
  ReviewDecisionInput,
  RouteDecision,
  RouteDecisionInput,
  ToolDecision,
  ToolDecisionInput,
  VerifyDecisionInput,
} from "./engine/deps.ts";
import { ARGS_REVIEWS } from "./engine/deps.ts";
import { ASK_USER, FIN, isExecutableRoute } from "./types/routes.ts";
import { ConfigManager } from "./config.ts";
import { DECISION_PROMPTS } from "./reasoner/prompts.ts";
import {
  estimateTokens,
  postJson,
  DecisionServiceUnavailableError,
  DecisionValidationError,
  TransportError,
} from "./llmTransport.ts";
import { errorMessage, isRecord } from "./utils.ts";
import { MODELS } from "./models.ts";

/** Una respuesta `noul` aprueba solo si su probabilidad supera este valor (estrictamente). */
const NOUL_APPROVE = 0.5;

/**
 * Construye la URL y el body serializado según el backend configurado.
 * eos  → /v1/decide,     payload sin model
 * d3   → /v1/systemone,  payload con model (Ollama)
 */
function buildDecisionRequest(
  config: ReturnType<typeof import("./config.ts").ConfigManager.getConfig>,
  payload: { state: string; questions: Record<string, unknown> }
): { url: string; body: string } {
  const base = config.decisionUrl.replace(/\/+$/, "");

  if (config.decisionBackend === "d3") {
    const url = base.endsWith("/v1/systemone") ? base : `${base}/v1/systemone`;
    return { url, body: JSON.stringify({ model: config.decisionModel, ...payload }) };
  }

  // eos (default)
  const url = base.endsWith("/v1/decide") ? base : `${base}/v1/decide`;
  return { url, body: JSON.stringify(payload) };
}

const pct = (probabilities: Record<string, number>): string =>
  Object.entries(probabilities)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`)
    .join(", ");

/**
 * Respuesta de `key` con el tipo esperado. `parseResponse` ya garantizó la forma: el chequeo solo estrecha el tipo.
 */
function choiceAnswer(response: DecisionResponse, key: string): DecisionAnswerChoice {
  const answer = response.answers[key];
  if (!("choice" in answer)) throw new DecisionValidationError(`Respuesta '${key}' inesperada: se esperaba tipo 'choice'.`);
  return answer;
}

function noulAnswer(response: DecisionResponse, key: string): DecisionAnswerNoul {
  const answer = response.answers[key];
  if (!("noul" in answer)) throw new DecisionValidationError(`Respuesta '${key}' inesperada: se esperaba tipo 'noul'.`);
  return answer;
}

/** Traza de una opción tomada sin consultar al modelo (había una sola). */
function shortcutTrace(choice: string, state: string): DecisionTrace {
  return {
    probabilities: { [choice]: 1 },
    rawInput: JSON.stringify({ state, single_option: choice }, null, 2),
    rawOutput: JSON.stringify({ choice, source: "single_option_shortcut" }, null, 2),
  };
}

/** La opción elegida de Decisión 1 como decisión del motor. `choice` ya es una de las ofrecidas. */
function routeDecisionOf(choice: string, trace: DecisionTrace, shortcut: boolean): RouteDecision {
  if (choice === FIN) return { action: FIN, ...trace };
  if (choice === ASK_USER) return { action: ASK_USER, ...trace };
  if (!isExecutableRoute(choice)) {
    throw new DecisionValidationError(`Decision #1: opción '${choice}' no es una ruta ejecutable.`);
  }
  return shortcut ? { action: "route", route: choice, shortcut: true, ...trace } : { action: "route", route: choice, ...trace };
}

export class Decision20Engine implements IDecisionEngine, IActionDecision {
  /**
   * Invoca `system_one` sobre el endpoint real. Devuelve las respuestas ya validadas contra `questions`
   * y los crudos de entrada/salida para depuración.
   */
  async systemOne(
    state: string,
    questions: Record<string, DecisionQuestion>,
    options?: { signal?: AbortSignal }
  ): Promise<DecisionResponse> {
    const config = ConfigManager.getConfig();
    if (!config.decisionUrl) {
      throw new DecisionServiceUnavailableError(
        "La URL de Decision 2.0 no está configurada. Configure la URL HTTP en la barra de configuración."
      );
    }

    const payload = { state, questions };

    // Guarda de contexto sobre el payload completo (los `criteria` viajan dentro de `questions`).
    const estimated = estimateTokens(JSON.stringify(payload));
    if (estimated > config.decisionMaxContext) {
      throw new DecisionValidationError(
        `Desbordamiento de contexto: ~${estimated} tokens superan el límite de ${config.decisionMaxContext}.`,
        true
      );
    }

    const { url, body } = buildDecisionRequest(config, payload);
    console.log(`[Decision → SEND] backend=${config.decisionBackend} url=${url} state=${JSON.stringify(state).slice(0, 200)} questions=${JSON.stringify(questions).slice(0, 200)}`);

    let result;
    const startedAt = Date.now();
    try {
      result = await postJson({ url, body, timeoutMs: config.decisionTimeoutMs, signal: options?.signal });
    } catch (err) {
      if (err instanceof TransportError) {
        throw new DecisionServiceUnavailableError(
          err.kind === "timeout"
            ? `Timeout (${config.decisionTimeoutMs}ms) esperando a Decision 2.0 en ${url}`
            : `No fue posible conectar con Decision 2.0 en ${url}. Verifique que el servicio esté en ejecución. ${err.message}`,
          err
        );
      }
      throw err; // RequestAbortedError
    }

    if (!result.ok) {
      throw new DecisionServiceUnavailableError(
        `HTTP ${result.status} (${result.statusText}): ${result.text.slice(0, 300)}`
      );
    }
    console.log(`[Decision ← RECV] ${result.text.slice(0, 600)}`);

    return {
      answers: this.parseResponse(result.text, questions),
      rawInput: JSON.stringify(payload, null, 2), // el mismo payload, legible
      rawOutput: result.text,
      timing: { startedAt, durationMs: Date.now() - startedAt },
    };
  }

  /** Decision #1: ruta de la siguiente acción. */
  async evaluateDecisionOne(
    taskMessage: string,
    historyContext: string = "",
    options?: {
      allowFin?: boolean;
      /** Observación compacta del último resultado, para que Decision la vea. */
      lastResult?: string;
      /** Acciones ya ejecutadas; marcan rutas cuyo último intento falló. */
      attempts?: Attempt[];
      signal?: AbortSignal;
    }
  ): Promise<DecisionOneResult> {
    const { state, questions } = DECISION_PROMPTS.buildDecisionOne({
      taskMessage,
      history: historyContext,
      allowFin: options?.allowFin !== false,
      lastResult: options?.lastResult,
      attempts: options?.attempts,
    });

    const t0 = Date.now();
    const response = await this.ask("Decision #1", state, questions, options?.signal);
    const { choice, probabilities } = choiceAnswer(response, "route");

    console.log(`[Decision #1] route=${choice} probabilities=[${pct(probabilities)}] duration=${Date.now() - t0}ms`);
    return { route: choice as StepRoute, probabilities, rawInput: response.rawInput, rawOutput: response.rawOutput, timing: response.timing };
  }

  /** Decision #2: tool dentro de las herramientas descubiertas del MCP activo. */
  async evaluateDecisionTwo(
    instruction: string,
    discoveredTools: MCPTool[],
    memory?: string,
    attempts?: Attempt[],
    options?: { mcp?: string; signal?: AbortSignal }
  ): Promise<DecisionTwoResult> {
    // Con una sola opción no hay decisión que tomar: se omite la llamada (sin simular una respuesta del modelo).
    if (discoveredTools.length === 1) {
      const tool = discoveredTools[0];
      console.log(`[Decision] tool=${tool.name} (única opción) duration=0ms`);
      return {
        selectedTool: tool,
        probabilities: { [tool.name]: 1 },
        rawInput: JSON.stringify({ state: instruction, single_tool: tool.name }, null, 2),
        rawOutput: JSON.stringify({ choice: tool.name, source: "single_tool_shortcut" }, null, 2),
        shortcut: true,
      };
    }

    const { state, questions } = DECISION_PROMPTS.buildDecisionTwo({
      instruction,
      memory: memory ?? "",
      tools: discoveredTools,
      attempts,
      mcp: options?.mcp,
    });

    const t0 = Date.now();
    const response = await this.ask("Decision #2", state, questions, options?.signal);
    const { choice, probabilities } = choiceAnswer(response, "selected_tool");
    // `criteria` se construyó con los nombres de discoveredTools y parseResponse validó la pertenencia.
    const selectedTool = discoveredTools.find((t) => t.name === choice)!;

    console.log(`[Decision] tool=${selectedTool.name} duration=${Date.now() - t0}ms`);
    return { selectedTool, probabilities, rawInput: response.rawInput, rawOutput: response.rawOutput, timing: response.timing };
  }

  /**
   * Decisión 1: ruta de la siguiente acción entre las ofrecidas (`input.routes`), `fin` (si `allowFin`) o `ask_user` (si
   * `allowAsk`). Con una sola opción no hay decisión que tomar y se omite la consulta; sin opciones es un defecto de quien
   * llama (el motor cierra el paso con `no_tools` antes). Las rutas y los identificadores salen de las constantes.
   */
  async chooseRoute(input: RouteDecisionInput, signal?: AbortSignal): Promise<RouteDecision> {
    const { state, questions } = DECISION_PROMPTS.buildRouteChoice(input);
    const question = questions.route;
    const options = question.type === "choice" ? Object.keys(question.criteria) : [];
    if (options.length === 0) throw new Error("chooseRoute: no hay opciones que ofrecer.");

    if (options.length === 1) {
      const choice = options[0];
      console.log(`[Decision #1] action=${choice} (única opción) duration=0ms`);
      return routeDecisionOf(choice, shortcutTrace(choice, state), true);
    }

    const t0 = Date.now();
    const response = await this.ask("Decision #1", state, questions, signal);
    const { choice, probabilities } = choiceAnswer(response, "route");
    console.log(`[Decision #1] action=${choice} probabilities=[${pct(probabilities)}] duration=${Date.now() - t0}ms`);

    const trace = { probabilities, rawInput: response.rawInput, rawOutput: response.rawOutput, timing: response.timing };
    // `parseResponse` validó la pertenencia a `criteria`; `routeDecisionOf` solo estrecha el tipo.
    return routeDecisionOf(choice, trace, false);
  }

  /**
   * Decisión 2: herramienta dentro de la ruta elegida, o `ask_user` (si `allowAsk`).
   * Con una sola herramienta y sin `ask_user` no hay decisión que tomar y se omite la llamada; con `ask_user` ofrecido
   * hay dos opciones y sí se consulta.
   */
  async chooseTool(input: ToolDecisionInput, signal?: AbortSignal): Promise<ToolDecision> {
    const { tools } = input;
    if (tools.length === 0) throw new Error("chooseTool: no hay herramientas candidatas.");

    if (tools.length === 1 && !input.allowAsk) {
      const tool = tools[0];
      console.log(`[Decision] tool=${tool.name} (única opción) duration=0ms`);
      return {
        action: "tool",
        tool,
        shortcut: true,
        probabilities: { [tool.name]: 1 },
        rawInput: JSON.stringify({ state: input.step?.instruction ?? input.request, single_tool: tool.name }, null, 2),
        rawOutput: JSON.stringify({ choice: tool.name, source: "single_tool_shortcut" }, null, 2),
      };
    }

    const { state, questions } = DECISION_PROMPTS.buildToolChoice(input);

    const t0 = Date.now();
    const response = await this.ask("Decision #2", state, questions, signal);
    const { choice, probabilities } = choiceAnswer(response, "selected_tool");
    console.log(`[Decision] action=${choice} probabilities=[${pct(probabilities)}] duration=${Date.now() - t0}ms`);

    const trace = { probabilities, rawInput: response.rawInput, rawOutput: response.rawOutput, timing: response.timing };
    if (choice === ASK_USER) return { action: ASK_USER, ...trace };
    const selected = tools.find((t) => t.name === choice);
    if (!selected) throw new DecisionValidationError(`Decision #2: la herramienta '${choice}' no está entre las candidatas.`);
    return { action: "tool", tool: selected, ...trace };
  }

  /**
   * Decisión 3: revisión de la llamada candidata. Una pregunta con cuatro opciones (aprobar o el escenario del rechazo);
   * siempre se consulta, porque nunca hay una sola opción.
   */
  async reviewArgs(input: ReviewDecisionInput, signal?: AbortSignal): Promise<ReviewDecision> {
    const { state, questions } = DECISION_PROMPTS.buildArgsReview(input);

    const t0 = Date.now();
    const response = await this.ask("Decision #3", state, questions, signal);
    const { choice, probabilities } = choiceAnswer(response, "review");
    console.log(`[Decision #3] review=${choice} probabilities=[${pct(probabilities)}] duration=${Date.now() - t0}ms`);

    // `parseResponse` validó la pertenencia a `criteria`; aquí solo se estrecha el tipo.
    const review = ARGS_REVIEWS.find((r) => r === choice);
    if (review === undefined) throw new DecisionValidationError(`Decision #3: resultado '${choice}' desconocido.`);
    return { review, probabilities, rawInput: response.rawInput, rawOutput: response.rawOutput, timing: response.timing };
  }

  /**
   * Decisión 4: verificación del resultado de la llamada evaluada, con el criterio del paso o de la solicitud (`forVerify`).
   * Mismas dos preguntas `noul` que `evaluateStepVerification`.
   */
  async verifyResult(input: VerifyDecisionInput, signal?: AbortSignal): Promise<StepVerificationResult> {
    const { state, questions } = DECISION_PROMPTS.buildResultVerification(input);
    return this.runVerification("Verification", input.call.split("\n", 1)[0], state, questions, signal);
  }

  /**
   * Verificación factual de paso con Decision (motor vigente): dos preguntas `noul` (`ok`, `cumple`).
   * Aprueba solo con probabilidad estrictamente mayor que NOUL_APPROVE.
   */
  async evaluateStepVerification(
    instruction: string,
    toolName: string,
    resultSummary: string,
    evidenceSummary?: string,
    expectedOutcome?: string,
    observation?: string,
    signal?: AbortSignal
  ): Promise<StepVerificationResult> {
    const { state, questions } = DECISION_PROMPTS.buildStepVerification({
      instruction,
      toolName,
      resultSummary,
      evidenceSummary,
      expectedOutcome,
      observation,
    });
    return this.runVerification("StepVerification", toolName, state, questions, signal);
  }

  /** Consulta de verificación común: las preguntas `ok` y `cumple`, aprobadas solo con probabilidad > NOUL_APPROVE. */
  private async runVerification(
    label: string,
    toolLabel: string,
    state: string,
    questions: Record<string, DecisionQuestion>,
    signal?: AbortSignal
  ): Promise<StepVerificationResult> {
    const t0 = Date.now();
    const response = await this.ask(label, state, questions, signal);
    const okProbability = noulAnswer(response, "ok").noul;
    const cumpleProbability = noulAnswer(response, "cumple").noul;
    const ok = okProbability > NOUL_APPROVE;
    const cumple = cumpleProbability > NOUL_APPROVE;

    const { decisionBackend, decisionModel } = ConfigManager.getConfig();
    const modelLabel = decisionBackend === "d3" ? decisionModel : MODELS.EOS_0_8B.short;
    console.log(
      `[${label} ${modelLabel}] ${toolLabel} ok=${ok} (p=${okProbability.toFixed(2)}) cumple=${cumple} (p=${cumpleProbability.toFixed(2)}) duration=${Date.now() - t0}ms`
    );
    return { ok, cumple, okProbability, cumpleProbability, rawInput: response.rawInput, rawOutput: response.rawOutput, timing: response.timing };
  }

  /** `systemOne` con el registro de error común a todas las evaluaciones. */
  private async ask(
    label: string,
    state: string,
    questions: Record<string, DecisionQuestion>,
    signal?: AbortSignal
  ): Promise<DecisionResponse> {
    try {
      return await this.systemOne(state, questions, { signal });
    } catch (err) {
      console.error(`[${label}] ${errorMessage(err)}`);
      throw err;
    }
  }

  /**
   * Único punto de validación. Verifica por pregunta (según su tipo, por forma y sin exigir un campo `type`):
   * - choice: `choice` existe en `criteria`; `probabilities` se conserva solo con valores numéricos.
   * - noul: número en [0, 1].
   */
  private parseResponse(raw: string, questions: Record<string, DecisionQuestion>): Record<string, DecisionAnswer> {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new DecisionValidationError("La respuesta de Decision 2.0 no es un JSON válido.");
    }
    if (!isRecord(data) || !isRecord(data.answers)) {
      throw new DecisionValidationError("La respuesta de Decision 2.0 no contiene la clave 'answers'.");
    }

    const answers: Record<string, DecisionAnswer> = {};
    for (const [key, question] of Object.entries(questions)) {
      const ans = data.answers[key];
      if (!isRecord(ans)) {
        throw new DecisionValidationError(`La respuesta no incluye la pregunta '${key}'.`);
      }

      if (question.type === "choice") {
        const choice = ans.choice;
        if (typeof choice !== "string" || !Object.hasOwn(question.criteria, choice)) {
          throw new DecisionValidationError(
            `'${key}': opción ${JSON.stringify(choice)} fuera de las permitidas (${Object.keys(question.criteria).join(", ")}).`
          );
        }
        const probabilities = isRecord(ans.probabilities)
          ? Object.fromEntries(Object.entries(ans.probabilities).filter((e): e is [string, number] => typeof e[1] === "number"))
          : {};
        answers[key] = { choice, probabilities };
      } else {
        const noul = ans.noul;
        if (typeof noul !== "number" || !(noul >= 0 && noul <= 1)) {
          throw new DecisionValidationError(`'${key}': 'noul' debe ser un número en [0, 1].`);
        }
        answers[key] = { noul };
      }
    }
    return answers;
  }
}