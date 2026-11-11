/**
 * JARVIS Core — Cliente del modelo generativo (LLM, API OpenAI-compatible)
 *
 * - POST {qwenUrl}/v1/chat/completions con structured outputs (json_schema) y parser tolerante como red de
 *   seguridad. Los argumentos de tools MCP usan json_object: sus schemas son dinámicos.
 * - Etapas (contrato `EngineLLM`, contracts.ts), todas desde las vistas del contexto: `generatePlanFromView` (plan y
 *   replan, de 1 a `maxSteps` pasos), `generateArgumentsFromView`, `generateQuestion` (texto de la pregunta al usuario) y
 *   `generateFinalFromView` (respuesta final).
 * - Thinking por etapa: plan y replan = true; arguments y question = false; final_response = config.thinking.
 * - Reintentos: red y HTTP 503 en models/transport; salida inválida o truncada: 1 reintento aquí, con el error
 *   previo en el prompt, más presupuesto de tokens y temperatura 0.3. Timeout y cancelación nunca se reintentan.
 * - Nada se infiere en silencio: ruta inválida, plan fuera de rango o expected_outcome vacío invalidan la salida; si
 *   persiste tras el reintento, `LLMValidationError` y quien ejecuta decide.
 */

import { BUDGET } from "../budget.ts";
import {
  EXECUTABLE_ROUTES,
  isExecutableRoute,
  type ArgumentsGenerationResult,
  type FailedAttempt,
  type MCPTool,
  type PlanStep,
  type PlanStepWire,
  type TimeSpan,
} from "../types.ts";
import type { ConfigSource } from "../config.ts";
import { PROMPTS, retryNote } from "./prompts.ts";
import type {
  ArgsFromViewInput,
  EngineLLM,
  FinalFromViewInput,
  FinalGenerationResult,
  GeneratedStep,
  PendingFromViewInput,
  PendingGenerationResult,
  PlanFromViewInput,
  PlanGenerationResult,
  QuestionGenerationResult,
  QuestionInput,
} from "../contracts.ts";
import {
  argumentsStageRequest,
  BASE_TEMPERATURE,
  finalStageRequest,
  pendingStageRequest,
  planStageRequest,
  questionStageRequest,
  RETRY_TEMPERATURE,
  RETRY_TOKEN_FACTOR,
  TRUNCATED,
} from "./stageRequests.ts";
import type { PromptSet, StageRequest } from "./stageRequests.ts";
import { isWholeRefToken, schemaTypes } from "../refs/refResolver.ts";
import {
  estimateTokens,
  postJson,
  LLMServiceUnavailableError,
  LLMValidationError,
  RequestAbortedError,
  TransportError,
} from "./transport.ts";
import { errorMessage, isRecord } from "../utils.ts";

type JsonSchema = Record<string, unknown>;

interface LlmDispatchResult {
  content: string;
  /** finish_reason === "length": la salida se cortó por el tope de tokens. */
  truncated: boolean;
  rawInput: string;
  rawOutput: string;
  /** Inicio y duración de la petición HTTP (incluye el reintento de transporte). */
  timing: TimeSpan;
}

const rawOf = ({ rawInput, rawOutput, timing }: LlmDispatchResult) => ({ rawInput, rawOutput, timing });

const nonEmptyString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Quita bloques <think>: cerrados, un </think> huérfano (la apertura iba en el template) y uno sin cierre. */
export function stripThink(raw: string): string {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const orphanClose = s.toLowerCase().lastIndexOf("</think>");
  if (orphanClose >= 0) s = s.slice(orphanClose + "</think>".length);
  return s.replace(/<think>[\s\S]*$/i, "").trim();
}

/**
 * Respuesta del servidor apta para registros, eventos y trazas. Es una lista blanca: solo salen campos
 * conocidos y `content` sin bloques <think>, así que ningún campo de razonamiento del servidor
 * (`reasoning`, `reasoning_content`, etc.) llega a un registro, sea cual sea su nombre.
 */
function sanitizedRawOutput(root: Record<string, unknown>, choice: Record<string, unknown>, content: string): string {
  return JSON.stringify({
    id: root.id,
    model: root.model,
    choices: [{
      index: choice.index,
      finish_reason: choice.finish_reason,
      message: { role: "assistant", content: stripThink(content) },
    }],
    usage: root.usage,
  }, null, 2);
}

/** Índice de la llave que cierra la abierta en `start`, respetando strings y escapes; -1 si no cierra. */
function closingBraceIndex(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Primer objeto JSON de llaves balanceadas que se pueda parsear como objeto. */
function extractJsonObject(s: string): Record<string, unknown> | null {
  for (let start = s.indexOf("{"); start >= 0; start = s.indexOf("{", start + 1)) {
    const end = closingBraceIndex(s, start);
    if (end < 0) continue;
    try {
      const parsed: unknown = JSON.parse(s.slice(start, end + 1));
      if (isRecord(parsed)) return parsed;
    } catch {
      // Llaves balanceadas que no son JSON: seguir con la siguiente llave.
    }
  }
  return null;
}

/**
 * Objeto JSON de la salida del modelo, sin bloques <think>. Orden: JSON directo del texto completo, JSON
 * directo del bloque ```json y objeto de llaves balanceadas (primero en el bloque, luego en el texto).
 * El JSON directo va antes que el fence porque sus propios strings pueden contener fences (p. ej. el
 * `content` de write_file con markdown). Un JSON válido que no sea objeto (p. ej. un arreglo) devuelve null.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = stripThink(raw);
  if (!cleaned) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  const fencedBody = fenced ? fenced[1].trim() : "";

  for (const candidate of [cleaned, fencedBody].filter(Boolean)) {
    try {
      const value: unknown = JSON.parse(candidate);
      return isRecord(value) ? value : null;
    } catch {
      // No es JSON directo: probar el siguiente candidato.
    }
  }

  for (const candidate of [fencedBody, cleaned].filter(Boolean)) {
    const found = extractJsonObject(candidate);
    if (found) return found;
  }
  return null;
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  switch (t) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "array": return Array.isArray(v);
    case "object": return isRecord(v);
    case "null": return v === null;
    default: return true; // tipo desconocido: no se rechaza
  }
}

/**
 * Valida los argumentos contra el inputSchema real de la tool (solo nivel superior):
 * requeridos presentes y no nulos, tipo y enum de cada propiedad declarada.
 * Un token de referencia ({{ref:rX}}) se acepta en cualquier propiedad: se sustituye después.
 * No valida anidados ni resuelve $ref/$defs.
 */
export function validateArgs(args: Record<string, unknown>, schema: MCPTool["inputSchema"]): string | null {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const problems: string[] = [];

  const missing = (schema.required ?? []).filter((k) => args[k] === undefined || args[k] === null);
  if (missing.length > 0) problems.push(`faltan campos requeridos: ${missing.join(", ")}`);

  for (const [key, value] of Object.entries(args)) {
    if (isWholeRefToken(value)) continue;
    if (!Object.hasOwn(props, key)) {
      if (schema.additionalProperties === false) problems.push(`parámetro no definido en el schema: ${key}`);
      continue;
    }
    const prop = props[key];
    if (isRecord(prop) && Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      problems.push(`${key}: valor fuera del enum`);
      continue;
    }
    const types = schemaTypes(prop);
    if (types.size > 0 && ![...types].some((t) => matchesType(value, t))) {
      problems.push(`${key}: se esperaba ${[...types].join("|")} y se recibió ${typeName(value)}`);
    }
  }
  return problems.length > 0 ? problems.join("; ") : null;
}

/**
 * Valida y normaliza pasos de plan. No corrige nada en silencio: ruta inválida, texto vacío o exceso de
 * pasos devuelven un error que se inyecta en el reintento. Los id los asigna el código (s<firstNumber>…).
 * Único punto donde PlanStepWire (formato del LLM) se traduce a PlanStep (dominio).
 */
export function parsePlanSteps(
  raw: unknown,
  firstNumber: number,
  allowEmpty: boolean,
): { steps: PlanStep[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "'steps' debe ser un arreglo" };
  if (raw.length === 0) return allowEmpty ? { steps: [] } : { error: "'steps' no puede estar vacío" };
  if (raw.length > BUDGET.maxSteps) return { error: `máximo ${BUDGET.maxSteps} pasos; se recibieron ${raw.length}` };

  const steps: PlanStep[] = [];
  for (const [i, s] of raw.entries()) {
    const n = i + 1;
    if (!isRecord(s)) return { error: `paso ${n}: no es un objeto` };
    const wire: Partial<Record<keyof PlanStepWire, unknown>> = s;
    const goal = nonEmptyString(wire.goal);
    if (!goal) return { error: `paso ${n}: 'goal' vacío` };
    const route = wire.suggested_mcp;
    if (!isExecutableRoute(route)) {
      return { error: `paso ${n}: suggested_mcp ${JSON.stringify(route)} inválido; debe ser uno de ${EXECUTABLE_ROUTES.join(", ")}` };
    }
    const expected = nonEmptyString(wire.expected_outcome);
    if (!expected) return { error: `paso ${n}: 'expected_outcome' vacío` };

    steps.push({ id: `s${firstNumber + i}`, instruction: goal, route, expectedOutcome: expected });
  }
  return { steps };
}

/** Valida la lista de pendientes del reactivo: arreglo de textos no vacíos (puede venir vacío). */
export function parsePendingList(raw: unknown): { pending: string[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "'pending' debe ser un arreglo" };
  const pending: string[] = [];
  for (const [i, item] of raw.entries()) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!text) return { error: `pendiente ${i + 1}: texto vacío` };
    pending.push(text);
  }
  return { pending };
}

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Validation<T> => ({ ok: true, value });
const fail = (error: string): Validation<never> => ({ ok: false, error });

/** Error de reintento de toda salida JSON no extraíble (lo reutiliza el eval). */
export const NOT_JSON = "la respuesta no es un objeto JSON válido";

/** Primer filtro de toda salida JSON: sin truncar y con un objeto parseable. */
const parseObjectOutput = (r: LlmDispatchResult): Validation<Record<string, unknown>> => {
  if (r.truncated) return fail(TRUNCATED);
  const parsed = parseJsonObject(r.content);
  return parsed ? ok(parsed) : fail(NOT_JSON);
};

const MIN_COMPLETION_TOKENS = 256;

interface DispatchOptions {
  stage: string;
  system: string;
  user: string;
  /** Pide JSON (json_schema si hay `schema`; si no, json_object). */
  json: boolean;
  schema?: JsonSchema;
  maxTokens: number;
  thinking: boolean;
  temperature: number;
  signal?: AbortSignal;
}

interface ValidatedDispatch<T> extends Omit<DispatchOptions, "temperature"> {
  /** Temperatura del primer intento (por defecto `BASE_TEMPERATURE`); el reintento usa `RETRY_TEMPERATURE` o más si esta ya la supera. */
  temperature?: number;
  /** Thinking en el reintento; por defecto el mismo. */
  retryThinking?: boolean;
  validate: (res: LlmDispatchResult, isLastAttempt: boolean) => Validation<T>;
}

/** Campos de una respuesta /v1/chat/completions; lo ausente o mal tipado toma un valor neutro. */
interface Completion {
  content: string;
  finishReason: string;
  promptTokens: number;
  completionTokens: number;
  /** Único punto por el que la respuesta cruda llega a memoria, eventos y trazas: sin pensamiento del modelo. */
  rawOutput: string;
}

function readCompletion(data: unknown): Completion {
  const root: Record<string, unknown> = isRecord(data) ? data : {};
  const choice: Record<string, unknown> = Array.isArray(root.choices) && isRecord(root.choices[0]) ? root.choices[0] : {};
  const message: Record<string, unknown> = isRecord(choice.message) ? choice.message : {};
  const usage: Record<string, unknown> = isRecord(root.usage) ? root.usage : {};
  const content = typeof message.content === "string" ? message.content : "";
  return {
    content,
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown",
    promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
    completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
    rawOutput: sanitizedRawOutput(root, choice, content),
  };
}

export class QwenEngine implements EngineLLM {
  /** `prompts`: los textos de cada etapa; por defecto los de producción (el laboratorio de evaluación pasa otros). */
  constructor(
    private readonly getConfig: ConfigSource,
    private readonly prompts: PromptSet = PROMPTS,
  ) { }

  /** Registro de duración y errores por etapa. La cancelación no se registra como error. */
  private async executeStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    console.log(`[Qwen] ${stage} start`);
    try {
      const result = await fn();
      console.log(`[Qwen] ${stage} done duration=${Date.now() - t0}ms`);
      return result;
    } catch (err) {
      const duration = Date.now() - t0;
      if (err instanceof RequestAbortedError) {
        console.log(`[Qwen] ${stage} cancelled duration=${duration}ms`);
      } else {
        const msg = errorMessage(err).replace(/\r?\n/g, " ").slice(0, 160);
        console.error(`[Qwen] ${stage} error=${msg} duration=${duration}ms`);
      }
      throw err;
    }
  }

  private resolveUrl(raw: string): string {
    const base = raw.trim().replace(/\/+$/, "");
    if (!base) {
      throw new LLMServiceUnavailableError("La URL de Qwen no está configurada. Configúrela en la barra de configuración.");
    }
    if (base.endsWith("/v1/chat/completions")) return base;
    if (/\/(generate|api\/chat)$/.test(base)) {
      throw new LLMServiceUnavailableError(
        `La URL de Qwen debe ser la base del servidor o terminar en /v1/chat/completions (recibido: ${base}). Los endpoints /generate y /api/chat ya no se admiten.`
      );
    }
    return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  }

  /**
   * Tokens de salida que se pueden pedir sin desbordar el contexto. Ollama recorta en silencio el prompt que no cabe y
   * puede perder el SYSTEM, así que un prompt sin margen de salida se rechaza antes de enviarlo.
   */
  private reserveCompletionTokens(o: DispatchOptions, numCtx: number): number {
    const promptEstimate = estimateTokens(o.system) + estimateTokens(o.user);
    const available = numCtx - promptEstimate;
    if (available < MIN_COMPLETION_TOKENS) {
      throw new LLMValidationError(
        `El prompt de '${o.stage}' (~${promptEstimate} tokens) no deja espacio de salida en el contexto de ${numCtx} tokens.`,
        undefined,
        undefined,
        true // desborde: no se envió nada y repetir no sirve (D15)
      );
    }
    const maxTokens = Math.min(o.maxTokens, available);
    if (maxTokens < o.maxTokens) {
      console.warn(`[Qwen] stage=${o.stage} max_tokens reducido ${o.maxTokens} -> ${maxTokens} por límite de contexto (${numCtx}).`);
    }
    return maxTokens;
  }

  private buildRequestBody(o: DispatchOptions, model: string, maxTokens: number): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: o.system },
        { role: "user", content: o.user },
      ],
      temperature: o.temperature,
      max_tokens: maxTokens,
      stream: false,
      reasoning_effort: o.thinking ? "low" : "none",
    };
    if (o.schema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: o.stage, strict: false, schema: o.schema },
      };
    } else if (o.json) {
      body.response_format = { type: "json_object" };
    }
    return body;
  }

  /** Una petición de inferencia. No valida el contenido. */
  private async dispatchPrompt(o: DispatchOptions): Promise<LlmDispatchResult> {
    const config = this.getConfig();
    const url = this.resolveUrl(config.qwenUrl);
    const maxTokens = this.reserveCompletionTokens(o, config.qwenNumCtx);

    const body = this.buildRequestBody(o, config.qwenModel, maxTokens);
    const rawInput = JSON.stringify(body, null, 2);

    console.log(`[Qwen → SEND] stage=${o.stage} system=${JSON.stringify(o.system).slice(0, 200)} user=${JSON.stringify(o.user).slice(0, 300)}`);

    const t0 = Date.now();
    const elapsed = (): TimeSpan => ({ startedAt: t0, durationMs: Date.now() - t0 });
    const timeoutMs = o.thinking ? config.qwenThinkingTimeoutMs : config.qwenTimeoutMs;
    let result;
    try {
      result = await postJson({ url, body: JSON.stringify(body), timeoutMs, signal: o.signal });
    } catch (err) {
      if (err instanceof TransportError) {
        throw new LLMServiceUnavailableError(
          err.kind === "timeout"
            ? `Timeout (${timeoutMs}ms) esperando a Qwen en ${url}`
            : `No fue posible conectar con Qwen en ${url}. Verifique que el servidor esté activo. ${err.message}`,
          err,
          { rawInput, timing: elapsed() }
        );
      }
      throw err;
    }

    if (!result.ok) {
      throw new LLMServiceUnavailableError(
        `HTTP ${result.status} (${result.statusText}): ${result.text.slice(0, 300)}`,
        undefined,
        { rawInput, timing: elapsed() }
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(result.text);
    } catch {
      // No se puede garantizar que un cuerpo ilegible no traiga pensamiento: solo se registra su tamaño.
      throw new LLMValidationError("La respuesta de Qwen no es un JSON legible.", { rawInput, rawOutput: `[respuesta no legible: ${result.text.length} caracteres]` });
    }

    const { content, finishReason, promptTokens, completionTokens, rawOutput } = readCompletion(data);
    const truncated = finishReason === "length";

    console.log(`[Qwen ← RECV] stage=${o.stage} raw=${rawOutput.slice(0, 400)}`);
    console.log(
      `[Qwen] stage=${o.stage} tokens=(in=${promptTokens}, out=${completionTokens}, max=${maxTokens}) finish_reason=${finishReason}${truncated ? " [LENGTH_EXCEEDED]" : ""} thinking=${o.thinking ? "yes" : "no"} duration=${Date.now() - t0}ms`
    );
    if (promptTokens + completionTokens >= config.qwenNumCtx) {
      console.warn(`[Qwen] stage=${o.stage} agotó el contexto (${promptTokens + completionTokens}/${config.qwenNumCtx}); el servidor pudo recortar el prompt.`);
    }

    return { content, truncated, rawInput, rawOutput, timing: elapsed() };
  }

  /**
   * Petición + validación con la política unificada de salida inválida: un reintento con el error
   * previo en el prompt, 1.5x tokens y temperatura 0.3. Si vuelve a fallar, LLMValidationError con el crudo.
   */
  private async dispatchValidated<T>(o: ValidatedDispatch<T>): Promise<{ value: T; res: LlmDispatchResult; failed: FailedAttempt[] }> {
    let previousError: string | undefined;
    let last: LlmDispatchResult | undefined;
    const failed: FailedAttempt[] = [];

    const retries = BUDGET.invalidResponseRetries;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const retry = attempt > 0;
      const res = await this.dispatchPrompt({
        stage: o.stage,
        system: o.system,
        user: o.user + retryNote(previousError),
        json: o.json,
        schema: o.schema,
        maxTokens: retry ? Math.ceil(o.maxTokens * RETRY_TOKEN_FACTOR) : o.maxTokens,
        thinking: retry ? (o.retryThinking ?? o.thinking) : o.thinking,
        temperature: retry ? Math.max(RETRY_TEMPERATURE, o.temperature ?? 0) : (o.temperature ?? BASE_TEMPERATURE),
        signal: o.signal,
      });
      last = res;

      const v = o.validate(res, attempt === retries);
      if (v.ok) return { value: v.value, res, failed };

      previousError = v.error;
      failed.push({ rawInput: res.rawInput, rawOutput: res.rawOutput, error: v.error, timing: res.timing });
      console.warn(`[Qwen] ${o.stage}: salida inválida (${v.error}); intento ${attempt + 1}/${retries + 1}`);
    }

    throw new LLMValidationError(
      `${o.stage}: ${previousError}`,
      last ? { rawInput: last.rawInput, rawOutput: last.rawOutput, timing: last.timing } : undefined,
      failed
    );
  }

  /** Argumentos desde la vista estructurada: validados contra el schema de la herramienta, con un reintento. */
  async generateArgumentsFromView(input: ArgsFromViewInput, signal?: AbortSignal): Promise<ArgumentsGenerationResult> {
    return this.executeStage("generateArgumentsFromView", () =>
      this.runArguments(input.tool, argumentsStageRequest(input, this.getConfig(), this.prompts), signal)
    );
  }

  /** Texto de la pregunta al usuario (`ask_user`, Fase 5). Salida vacía: un reintento aquí; si persiste, `LLMValidationError`. */
  async generateQuestion(input: QuestionInput, signal?: AbortSignal): Promise<QuestionGenerationResult> {
    return this.executeStage("generateQuestion", async () => {
      const { value, res } = await this.dispatchValidated<string>({
        ...questionStageRequest(input, this.prompts),
        signal,
        validate: (r, isLast) => {
          const text = stripThink(r.content).trim();
          if (!text) return fail("salida vacía");
          if (!r.truncated) return ok(text);
          return isLast ? ok(text) : fail(TRUNCATED);
        },
      });

      return { question: value, ...rawOf(res) };
    });
  }

  /**
   * Lista de pendientes del reactivo: un objeto `{ pending: string[] }`. Una lista vacía es válida (nada por hacer); un
   * ítem que no es texto o está vacío es salida inválida y se repite una vez.
   */
  async generatePendingFromView(input: PendingFromViewInput, signal?: AbortSignal): Promise<PendingGenerationResult> {
    return this.executeStage("generatePendingFromView", async () => {
      const { value, res } = await this.dispatchValidated<string[]>({
        ...pendingStageRequest(input, this.prompts),
        signal,
        validate: (r) => {
          const out = parseObjectOutput(r);
          if (!out.ok) return out;
          const parsed = parsePendingList(out.value.pending);
          return "error" in parsed ? fail(parsed.error) : ok(parsed.pending);
        },
      });
      return { pending: value, ...rawOf(res) };
    });
  }

  /**
   * LLM 1 desde la vista (Fase 6): plan inicial, replan por fallo de paso o por instrucción del usuario. El plan trae entre 1
   * y `maxSteps` pasos; el cliente valida el rango para que cuente como salida inválida y se repita una vez.
   */
  async generatePlanFromView(input: PlanFromViewInput, signal?: AbortSignal): Promise<PlanGenerationResult> {
    return this.executeStage("generatePlanFromView", async () => {
      const { value, res } = await this.dispatchValidated<GeneratedStep[]>({
        ...planStageRequest(input, this.getConfig(), this.prompts),
        signal,
        validate: (r) => {
          const out = parseObjectOutput(r);
          if (!out.ok) return out;
          const parsed = parsePlanSteps(out.value.steps, 1, false);
          if ("error" in parsed) return fail(parsed.error);
          if (parsed.steps.length > input.maxSteps) return fail(`máximo ${input.maxSteps} pasos; se recibieron ${parsed.steps.length}`);
          return ok(parsed.steps.map((s) => ({ instruction: s.instruction, route: s.route, expected: s.expectedOutcome })));
        },
      });
      return { steps: value, ...rawOf(res) };
    });
  }

  /** LLM 3 desde la vista (Fase 6): respuesta final. Misma política de salida vacía o truncada que `generateFinalResponse`. */
  async generateFinalFromView(input: FinalFromViewInput, signal?: AbortSignal): Promise<FinalGenerationResult> {
    return this.executeStage("generateFinalFromView", async () => {
      const { value, res } = await this.dispatchValidated<string>({
        ...finalStageRequest(input, this.getConfig(), this.prompts),
        signal,
        validate: (r, isLast) => {
          const text = stripThink(r.content);
          if (!text) return fail("salida vacía");
          if (!r.truncated) return ok(text);
          return isLast ? ok(`${text}\n\n[Respuesta truncada por el límite de tokens]`) : fail(TRUNCATED);
        },
      });
      return { response: value, ...rawOf(res) };
    });
  }

  /** Núcleo común de la generación de argumentos: despacho, validación contra el schema de la herramienta y reintento. */
  private async runArguments(tool: MCPTool, request: StageRequest, signal?: AbortSignal): Promise<ArgumentsGenerationResult> {
    const inputSchema = tool.inputSchema;
    const required = inputSchema.required ?? [];

    const { value, res, failed } = await this.dispatchValidated<Record<string, unknown>>({
      ...request,
      signal,
      validate: (r) => {
        const out = parseObjectOutput(r);
        if (!out.ok) return out;
        const parsed = out.value;
        // null en un parámetro opcional equivale a "no usado".
        for (const k of Object.keys(parsed)) {
          if (parsed[k] === null && !required.includes(k)) delete parsed[k];
        }
        const problem = validateArgs(parsed, inputSchema);
        return problem ? fail(problem) : ok(parsed);
      },
    });

    return { args: value, ...rawOf(res), failedAttempts: failed };
  }
}
