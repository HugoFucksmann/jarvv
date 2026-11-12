/**
 * Modelo de decisión — Adaptador HTTP real
 * Protocolo: `POST {decisionUrl}/v1/systemone` con `{ model, state, questions }` → `{ answers }`. El servidor es Ollama
 * local o, a futuro, una URL remota con el mismo contrato.
 *
 * - Integración HTTP real contra la URL configurada; sin simulaciones. Si el servicio no está configurado o no
 *   responde, lanza DecisionServiceUnavailableError.
 * - `chooseRoute` y `chooseTool` (contrato `IActionDecision`, contracts.ts) reciben el marco de `forRoute`, `reviewArgs`
 *   (Decisión 3) el de `forReview` y `verifyResult` (Decisión 4) el de `forVerify`.
 * - Tipos de pregunta implementados: `choice` y `noul`. El contrato también define `score`; no se usa ni se implementa.
 * - Validación de la respuesta en un solo punto (parseResponse); el resto del código confía en ella.
 * - Las respuestas `noul` se devuelven como probabilidades: el umbral y el veredicto son de `engine/verify.ts`.
 * - Transporte (reintento único en red/503, timeout, cancelación): models/transport.ts.
 */

import {
  type DecisionAnswer,
  type DecisionAnswerChoice,
  type DecisionAnswerNoul,
  type DecisionQuestion,
  type DecisionResponse,
} from "../types.ts";
import type {
  DecisionTrace,
  IActionDecision,
  ReviewDecision,
  ReviewDecisionInput,
  RouteDecision,
  RouteDecisionInput,
  ToolDecision,
  ToolDecisionInput,
  VerifyCheckKey,
  VerifyDecision,
  VerifyDecisionInput,
} from "../contracts.ts";
import { ARGS_REVIEWS, VERIFY_CHECKS } from "../contracts.ts";
import { isExecutableRoute } from "../types/routes.ts";
import type { ConfigSource, JarvisConfig } from "../config.ts";
import { DECISION_PROMPTS } from "./prompts.ts";
import {
  estimateTokens,
  postJson,
  DecisionServiceUnavailableError,
  DecisionValidationError,
  TransportError,
} from "./transport.ts";
import { errorMessage, isRecord } from "../utils.ts";
import type { FragmentJudge, FragmentScores } from "../tools/judge.ts";

/** URL y body serializado de la consulta: `/v1/systemone` sobre `decisionUrl`, con el modelo configurado. */
function buildDecisionRequest(
  config: JarvisConfig,
  payload: { state: string; questions: Record<string, unknown> }
): { url: string; body: string } {
  const base = config.decisionUrl.replace(/\/+$/, "");
  const url = base.endsWith("/v1/systemone") ? base : `${base}/v1/systemone`;
  return { url, body: JSON.stringify({ model: config.decisionModel, ...payload }) };
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
  if (!isExecutableRoute(choice)) {
    throw new DecisionValidationError(`Decision #1: opción '${choice}' no es una ruta ejecutable.`);
  }
  return shortcut ? { action: "route", route: choice, shortcut: true, ...trace } : { action: "route", route: choice, ...trace };
}

/** Fragmentos que se puntúan en una misma consulta al modelo (una pregunta `noul` por fragmento). */
/** Fragmentos por consulta del juez (una pregunta `noul` cada uno). */
export const JUDGE_BATCH = 5;

export class Decision20Engine implements IActionDecision, FragmentJudge {
  /** `prompts`: los constructores de las preguntas de cada decisión; por defecto los de producción (el laboratorio de evaluación pasa otros). */
  constructor(
    private readonly getConfig: ConfigSource,
    private readonly prompts: typeof DECISION_PROMPTS = DECISION_PROMPTS,
  ) { }

  /**
   * Invoca `system_one` sobre el endpoint real. Devuelve las respuestas ya validadas contra `questions`
   * y los crudos de entrada/salida para depuración.
   */
  async systemOne(
    state: string,
    questions: Record<string, DecisionQuestion>,
    options?: { signal?: AbortSignal }
  ): Promise<DecisionResponse> {
    const config = this.getConfig();
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
    console.log(`[Decision → SEND] model=${config.decisionModel} url=${url} state=${JSON.stringify(state).slice(0, 200)} questions=${JSON.stringify(questions).slice(0, 200)}`);

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
      answers: parseResponse(result.text, questions),
      rawInput: JSON.stringify(payload, null, 2), // el mismo payload, legible
      rawOutput: result.text,
      timing: { startedAt, durationMs: Date.now() - startedAt },
    };
  }

  /**
   * Decisión 1: ruta de la siguiente acción entre las ofrecidas (`input.routes`). Con una sola opción no hay decisión que
   * tomar y se omite la consulta; sin opciones es un defecto de quien llama (el motor cierra el paso con `no_tools` antes).
   * Las rutas salen de las constantes.
   */
  async chooseRoute(input: RouteDecisionInput, signal?: AbortSignal): Promise<RouteDecision> {
    const { state, questions } = this.prompts.buildRouteChoice(input);
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
   * Decisión 2: herramienta dentro de la ruta elegida. Con una sola herramienta no hay decisión que tomar y se omite la
   * consulta.
   */
  async chooseTool(input: ToolDecisionInput, signal?: AbortSignal): Promise<ToolDecision> {
    const { tools } = input;
    if (tools.length === 0) throw new Error("chooseTool: no hay herramientas candidatas.");

    if (tools.length === 1) {
      const tool = tools[0];
      console.log(`[Decision] tool=${tool.name} (única opción) duration=0ms`);
      return {
        action: "tool",
        tool,
        shortcut: true,
        probabilities: { [tool.name]: 1 },
        rawInput: JSON.stringify({ state: input.step?.instruction ?? null, single_tool: tool.name }, null, 2),
        rawOutput: JSON.stringify({ choice: tool.name, source: "single_tool_shortcut" }, null, 2),
      };
    }

    const { state, questions } = this.prompts.buildToolChoice(input);

    const t0 = Date.now();
    const response = await this.ask("Decision #2", state, questions, signal);
    const { choice, probabilities } = choiceAnswer(response, "selected_tool");
    console.log(`[Decision] action=${choice} probabilities=[${pct(probabilities)}] duration=${Date.now() - t0}ms`);

    const trace = { probabilities, rawInput: response.rawInput, rawOutput: response.rawOutput, timing: response.timing };
    const selected = tools.find((t) => t.name === choice);
    if (!selected) throw new DecisionValidationError(`Decision #2: la herramienta '${choice}' no está entre las candidatas.`);
    return { action: "tool", tool: selected, ...trace };
  }

  /**
   * Decisión 3: revisión de la llamada candidata. Una pregunta con tres opciones (aprobar o el escenario del rechazo);
   * siempre se consulta, porque nunca hay una sola opción.
   */
  async reviewArgs(input: ReviewDecisionInput, signal?: AbortSignal): Promise<ReviewDecision> {
    const { state, questions } = this.prompts.buildArgsReview(input);

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
   * Decisión 4: verificación del resultado de la llamada evaluada, con el criterio del paso (`forVerify`). Una pregunta
   * `noul` por cada entrada de `VERIFY_CHECKS`; devuelve sus probabilidades sin umbral: el veredicto es de `verdictOf`.
   */
  async verifyResult(input: VerifyDecisionInput, signal?: AbortSignal): Promise<VerifyDecision> {
    const { state, questions } = this.prompts.buildResultVerification(input);

    const t0 = Date.now();
    const response = await this.ask("Verification", state, questions, signal);
    const answers = Object.fromEntries(VERIFY_CHECKS.map(({ key }) => [key, noulAnswer(response, key).noul])) as Record<VerifyCheckKey, number>;

    const probabilities = VERIFY_CHECKS.map(({ key }) => `${key}=${answers[key].toFixed(2)}`).join(" ");
    console.log(
      `[Verification ${this.getConfig().decisionModel}] ${input.call.split("\n", 1)[0]} ${probabilities} duration=${Date.now() - t0}ms`
    );
    return { answers, rawInput: response.rawInput, rawOutput: response.rawOutput, timing: response.timing };
  }

  /**
   * Puntúa fragmentos de texto ajeno contra una pregunta (`FragmentJudge`, lo usa `web_search`): una pregunta `noul` por fragmento, en lotes de `JUDGE_BATCH`.
   * El texto de la pregunta lo arma `DECISION_PROMPTS.buildFragmentJudge` (el fragmento es no confiable: lo único que sale de él es una probabilidad).
   */
  async score(need: string, fragments: readonly string[], signal?: AbortSignal): Promise<FragmentScores> {
    const t0 = Date.now();
    const probabilities: number[] = [];
    const inputs: string[] = [];
    const outputs: string[] = [];
    for (let start = 0; start < fragments.length; start += JUDGE_BATCH) {
      const batch = fragments.slice(start, start + JUDGE_BATCH);
      const { state, questions } = this.prompts.buildFragmentJudge({ need, fragments: batch });
      const response = await this.ask("Judge", state, questions, signal);
      batch.forEach((_, i) => probabilities.push(noulAnswer(response, `f${i}`).noul));
      inputs.push(response.rawInput);
      outputs.push(response.rawOutput);
    }
    return { probabilities, rawInput: inputs.join("\n"), rawOutput: outputs.join("\n"), durationMs: Date.now() - t0 };
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

}

// ───────────────────────── Validación de la respuesta ─────────────────────────
// Funciones sueltas y exportadas: el eval valida con el mismo código que producción (por pregunta, para tolerar una mal formada).

/** El objeto `answers` de la respuesta cruda de Decision: JSON válido con esa clave. */
export function parseAnswersObject(raw: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new DecisionValidationError("La respuesta de Decision 2.0 no es un JSON válido.");
  }
  if (!isRecord(data) || !isRecord(data.answers)) {
    throw new DecisionValidationError("La respuesta de Decision 2.0 no contiene la clave 'answers'.");
  }
  return data.answers;
}

/**
 * Valida la respuesta de UNA pregunta (según su tipo, por forma y sin exigir un campo `type`):
 * - choice: `choice` existe en `criteria`; `probabilities` se conserva solo con valores numéricos.
 * - noul: número en [0, 1].
 */
export function validateAnswer(key: string, question: DecisionQuestion, ans: unknown): DecisionAnswer {
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
    return { choice, probabilities };
  }
  const noul = ans.noul;
  if (typeof noul !== "number" || !(noul >= 0 && noul <= 1)) {
    throw new DecisionValidationError(`'${key}': 'noul' debe ser un número en [0, 1].`);
  }
  return { noul };
}

/** Único punto de validación de una consulta completa: todas las preguntas enviadas deben venir bien respondidas. */
export function parseResponse(raw: string, questions: Record<string, DecisionQuestion>): Record<string, DecisionAnswer> {
  const given = parseAnswersObject(raw);
  const answers: Record<string, DecisionAnswer> = {};
  for (const [key, question] of Object.entries(questions)) answers[key] = validateAnswer(key, question, given[key]);
  return answers;
}