/**
 * Decision 2.0 — Adaptador HTTP real
 * Modelo: vllm-sr/Decision-2.0-Eos-0.8B (contrato: state + questions -> answers)
 *
 * - Integración HTTP real contra la URL configurada; sin simulaciones. Si el servicio no está configurado o no
 *   responde, lanza DecisionServiceUnavailableError.
 * - Tipos de pregunta implementados: `choice` y `noul`. El contrato también define `score`; no se usa ni se implementa.
 * - Validación de la respuesta en un solo punto (parseResponse); el resto del código confía en ella.
 * - Umbral de `noul`: se aprueba solo con probabilidad estrictamente mayor que 0.5 (ante ambigüedad, no se aprueba).
 * - Transporte (reintento único en red/503, timeout, cancelación): llmTransport.ts.
 */

import {
  type DecisionAnswer,
  type DecisionQuestion,
  type DecisionResponse,
  type MCPTool,
  type StepRoute,
} from "./types.ts";
import { ConfigManager } from "./config.ts";
import { DECISION_PROMPTS, type Attempt } from "./reasoner/prompts.ts";
import { estimateTokens, postJson, TransportError } from "./llmTransport.ts";

export class DecisionServiceUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`[Decision 2.0 Unavailable] ${message}`, { cause });
    this.name = "DecisionServiceUnavailableError";
  }
}

export class DecisionValidationError extends Error {
  constructor(message: string) {
    super(`[Decision 2.0 Validation] ${message}`);
    this.name = "DecisionValidationError";
  }
}

/** Una respuesta `noul` aprueba solo si su probabilidad supera este valor (estrictamente). */
const NOUL_APPROVE = 0.5;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const pct = (probabilities: Record<string, number>): string =>
  Object.entries(probabilities)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`)
    .join(", ");

export class Decision20Engine {
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
    const endpoint = config.decisionUrl;
    if (!endpoint) {
      throw new DecisionServiceUnavailableError(
        "La URL de Decision 2.0 no está configurada. Configure la URL HTTP en la barra de configuración."
      );
    }

    const payload = { state, questions };
    const body = JSON.stringify(payload);

    // Guarda de contexto sobre el payload completo (los `criteria` viajan dentro de `questions`).
    const estimated = estimateTokens(body);
    if (estimated > config.decisionMaxContext) {
      throw new DecisionValidationError(
        `Desbordamiento de contexto: ~${estimated} tokens superan el límite de ${config.decisionMaxContext}.`
      );
    }

    const url = endpoint.endsWith("/v1/decide") ? endpoint : `${endpoint.replace(/\/+$/, "")}/v1/decide`;
    console.log(`[Decision → SEND] state=${JSON.stringify(state).slice(0, 300)} questions=${JSON.stringify(questions).slice(0, 300)}`);

    let result;
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
    };
  }

  /** Decision #1: ruta de la siguiente acción. */
  async evaluateDecisionOne(
    taskMessage: string,
    historyContext: string | string[] = [],
    options?: {
      allowFin?: boolean;
      /** Observación compacta del último resultado, para que Decision la vea. */
      lastResult?: string;
      /** Acciones ya ejecutadas; marcan rutas cuyo último intento falló. */
      attempts?: Attempt[];
      signal?: AbortSignal;
    }
  ): Promise<{
    route: StepRoute;
    probabilities: Record<string, number>;
    rawInput: string;
    rawOutput: string;
  }> {
    const history = Array.isArray(historyContext) ? historyContext.slice(-3).join("\n") : historyContext;
    const { state, questions } = DECISION_PROMPTS.buildDecisionOne({
      taskMessage,
      history,
      allowFin: options?.allowFin !== false,
      lastResult: options?.lastResult,
      attempts: options?.attempts,
    });

    const t0 = Date.now();
    const response = await this.ask("Decision #1", state, questions, options?.signal);
    // parseResponse garantiza que `choice` pertenece a `criteria` (rutas ejecutables, más `fin` si se permite).
    const { choice, probabilities } = response.answers.route as { choice: string; probabilities: Record<string, number> };

    console.log(`[Decision #1] route=${choice} probabilities=[${pct(probabilities)}] duration=${Date.now() - t0}ms`);
    return { route: choice as StepRoute, probabilities, rawInput: response.rawInput, rawOutput: response.rawOutput };
  }

  /** Decision #2: tool dentro de las herramientas descubiertas del MCP activo. */
  async evaluateDecisionTwo(
    instruction: string,
    discoveredTools: MCPTool[],
    scratchpadSummary?: string,
    attempts?: Attempt[],
    options?: { mcp?: string; signal?: AbortSignal }
  ): Promise<{
    selectedTool: MCPTool;
    probabilities: Record<string, number>;
    rawInput: string;
    rawOutput: string;
  }> {
    if (discoveredTools.length === 0) {
      throw new DecisionValidationError("Decision #2 falló: no se proporcionaron herramientas descubiertas.");
    }

    // Con una sola opción no hay decisión que tomar: se omite la llamada (sin simular una respuesta del modelo).
    if (discoveredTools.length === 1) {
      const tool = discoveredTools[0];
      console.log(`[Decision] tool=${tool.name} (única opción) duration=0ms`);
      return {
        selectedTool: tool,
        probabilities: { [tool.name]: 1 },
        rawInput: JSON.stringify({ state: instruction, single_tool: tool.name }, null, 2),
        rawOutput: JSON.stringify({ choice: tool.name, source: "single_tool_shortcut" }, null, 2),
      };
    }

    const { state, questions } = DECISION_PROMPTS.buildDecisionTwo({
      instruction,
      scratchpadContext: scratchpadSummary ?? "",
      tools: discoveredTools,
      attempts,
      mcp: options?.mcp,
    });

    const t0 = Date.now();
    const response = await this.ask("Decision #2", state, questions, options?.signal);
    const { choice, probabilities } = response.answers.selected_tool as { choice: string; probabilities: Record<string, number> };
    // `criteria` se construyó con los nombres de discoveredTools y parseResponse validó la pertenencia.
    const selectedTool = discoveredTools.find((t) => t.name === choice)!;

    console.log(`[Decision] tool=${selectedTool.name} duration=${Date.now() - t0}ms`);
    return { selectedTool, probabilities, rawInput: response.rawInput, rawOutput: response.rawOutput };
  }

  /**
   * Verificación factual de paso con Eos: dos preguntas `noul` (`ok`, `cumple`).
   * Aprueba solo con probabilidad estrictamente mayor que NOUL_APPROVE.
   */
  async evaluateStepVerification(
    instruction: string,
    toolName: string,
    resultSummary: string,
    evidenceSummary?: string,
    expectedOutcome?: string,
    signal?: AbortSignal
  ): Promise<{
    ok: boolean;
    cumple: boolean;
    okProbability: number;
    cumpleProbability: number;
    rawInput: string;
    rawOutput: string;
  }> {
    const { state, questions } = DECISION_PROMPTS.buildStepVerification({
      instruction,
      toolName,
      resultSummary,
      evidenceSummary,
      expectedOutcome,
    });

    const t0 = Date.now();
    const response = await this.ask("StepVerification", state, questions, signal);
    const okProbability = (response.answers.ok as { noul: number }).noul;
    const cumpleProbability = (response.answers.cumple as { noul: number }).noul;
    const ok = okProbability > NOUL_APPROVE;
    const cumple = cumpleProbability > NOUL_APPROVE;

    console.log(
      `[StepVerification Eos] tool=${toolName} ok=${ok} (p=${okProbability.toFixed(2)}) cumple=${cumple} (p=${cumpleProbability.toFixed(2)}) duration=${Date.now() - t0}ms`
    );
    return { ok, cumple, okProbability, cumpleProbability, rawInput: response.rawInput, rawOutput: response.rawOutput };
  }

  /** `systemOne` con el registro de error común a todas las evaluaciones. */
  private async ask(
    label: string,
    state: string,
    questions: Record<string, DecisionQuestion>,
    signal?: AbortSignal
  ): Promise<DecisionResponse> {
    const t0 = Date.now();
    try {
      return await this.systemOne(state, questions, { signal });
    } catch (err) {
      console.error(`[${label}] error=${err instanceof Error ? err.message : String(err)} duration=${Date.now() - t0}ms`);
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