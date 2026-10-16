/**
 * JARVIS Core — Cliente del motor de razonamiento (Qwen, API OpenAI-compatible)
 *
 * - Un solo dialecto: POST {qwenUrl}/v1/chat/completions.
 * - Structured outputs (json_schema) + parser tolerante como red de seguridad.
 *   Los argumentos de tools MCP usan json_object: sus schemas son dinámicos y no se fuerzan como strict.
 * - Thinking por etapa: plan y replan = true; arguments y verify_stage = false; final_response = config.thinking.
 * - Reintentos: red y HTTP 503 en llmTransport; salida inválida o truncada: 1 reintento aquí, con el error
 *   previo en el prompt, más presupuesto de tokens y temperatura 0.3. Timeout y cancelación nunca se reintentan.
 * - Nada se infiere en silencio: ruta inválida, plan demasiado largo o expected_outcome vacío invalidan la salida.
 */

import {
  EXECUTABLE_ROUTES,
  LLM_INVALID_OUTPUT_RETRIES,
  MAX_STEPS,
  isExecutableRoute,
  type MCPTool,
  type Plan,
  type PlanStep,
  type StageVerificationPromptData,
  type StageVerificationResult,
  type StageVerificationStatus,
} from "../types.ts";
import { ConfigManager } from "../config.ts";
import {
  PROMPTS,
  retryNote,
  type ArgumentPromptData,
  type FinalResponsePromptData,
  type ReplanPromptData,
} from "./prompts.ts";
import { buildCompactCatalog } from "../tools/manifest.ts";
import { isWholeRefToken, schemaTypes } from "../processor/refResolver.ts";
import { estimateTokens, postJson, RequestAbortedError, TransportError } from "../llmTransport.ts";

// ============================================================
// Errores
// ============================================================

/** Qwen no responde: red, HTTP no-OK, timeout o configuración ausente. */
export class LLMServiceUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`[Qwen Unavailable] ${message}`, { cause });
    this.name = "LLMServiceUnavailableError";
  }
}

/** Qwen respondió, pero la salida no es utilizable tras el reintento (o el prompt no cabe en el contexto). */
export class LLMValidationError extends Error {
  readonly raw?: { rawInput: string; rawOutput: string };
  constructor(message: string, raw?: { rawInput: string; rawOutput: string }) {
    super(`[Qwen Validation] ${message}`);
    this.name = "LLMValidationError";
    this.raw = raw;
  }
}

// ============================================================
// Schemas JSON (derivados de EXECUTABLE_ROUTES y MAX_STEPS)
// ============================================================

type JsonSchema = Record<string, unknown>;

const STEP_ITEM_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    goal: { type: "string" },
    suggested_mcp: { type: "string", enum: [...EXECUTABLE_ROUTES] },
    expected_outcome: { type: "string" },
  },
  required: ["goal", "suggested_mcp", "expected_outcome"],
  additionalProperties: false,
};

export const PLAN_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    objective: { type: "string" },
    steps: { type: "array", items: STEP_ITEM_SCHEMA, maxItems: MAX_STEPS },
  },
  required: ["objective", "steps"],
  additionalProperties: false,
};

export const REPLAN_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["continue", "abort"] },
    reason: { type: "string" },
    objective: { type: "string" },
    steps: { type: "array", items: STEP_ITEM_SCHEMA, maxItems: MAX_STEPS },
  },
  required: ["action", "steps"],
  additionalProperties: false,
};

const STAGE_STATUSES = [
  "completed",
  "recoverable_deviation",
  "insufficient_info",
  "unrecoverable_blocked",
] as const satisfies readonly StageVerificationStatus[];

export const STAGE_VERIFICATION_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: [...STAGE_STATUSES] },
    reason: { type: "string" },
    question_for_user: { type: "string" },
  },
  required: ["status", "reason"],
  additionalProperties: false,
};

// ============================================================
// Contratos públicos
// ============================================================

export interface ArgumentsGenerationResult {
  args: Record<string, unknown>;
  rawInput: string;
  rawOutput: string;
}

export interface FinalResponseResult {
  response: string;
  rawInput: string;
  rawOutput: string;
}

export interface ReplanResult {
  action?: "abort";
  reason?: string;
  plan?: Plan;
  rawInput?: string;
  rawOutput?: string;
}

export interface ILLMClient {
  generateArguments(data: ArgumentPromptData, signal?: AbortSignal): Promise<ArgumentsGenerationResult>;

  generateFinalResponse(data: FinalResponsePromptData, signal?: AbortSignal): Promise<FinalResponseResult>;

  generatePlan(
    userMessage: string,
    chatContext?: string,
    signal?: AbortSignal,
    compactCatalog?: string,
    modificationFeedback?: string,
    existingPlanSummary?: string
  ): Promise<Plan>;

  replan(data: ReplanPromptData, signal?: AbortSignal): Promise<ReplanResult>;

  verifyStage(data: StageVerificationPromptData, signal?: AbortSignal): Promise<StageVerificationResult>;
}

interface QwenDispatchResult {
  content: string;
  /** finish_reason === "length": la salida se cortó por el tope de tokens. */
  truncated: boolean;
  rawInput: string;
  rawOutput: string;
}

// ============================================================
// Parsing y validación (puros)
// ============================================================

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const nonEmptyString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Quita bloques <think>: cerrados, un </think> huérfano (la apertura iba en el template) y uno sin cierre. */
export function stripThink(raw: string): string {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const orphanClose = s.toLowerCase().lastIndexOf("</think>");
  if (orphanClose >= 0) s = s.slice(orphanClose + "</think>".length);
  return s.replace(/<think>[\s\S]*$/i, "").trim();
}

/** Primer objeto JSON de llaves balanceadas, respetando strings y escapes. */
function extractJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/**
 * think-strip y, en este orden: JSON directo del texto completo, JSON directo del bloque ```json y extracción
 * por llaves balanceadas (primero sobre el bloque, luego sobre el texto completo).
 * El JSON directo va antes que el bloque ``` porque sus propios strings pueden contener fences (p. ej. el
 * `content` de write_file con markdown): buscar el fence primero cortaría el JSON a mitad de un string.
 * Un JSON válido que no sea objeto (p. ej. un arreglo) devuelve null, sin extraer nada en silencio.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = stripThink(raw);
  if (!cleaned) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  const fencedBody = fenced ? fenced[1].trim() : "";

  const parseStrict = (text: string): { value: unknown } | null => {
    try {
      return { value: JSON.parse(text) };
    } catch {
      return null;
    }
  };

  for (const candidate of fencedBody ? [cleaned, fencedBody] : [cleaned]) {
    const direct = parseStrict(candidate);
    if (direct) return isRecord(direct.value) ? direct.value : null;
  }

  for (const candidate of fencedBody ? [fencedBody, cleaned] : [cleaned]) {
    const extracted = extractJsonObject(candidate);
    const parsed = extracted ? parseStrict(extracted) : null;
    if (parsed && isRecord(parsed.value)) return parsed.value;
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
 */
export function parsePlanSteps(
  raw: unknown,
  firstNumber: number,
  allowEmpty: boolean,
): { steps: PlanStep[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "'steps' debe ser un arreglo" };
  if (raw.length === 0) return allowEmpty ? { steps: [] } : { error: "'steps' no puede estar vacío" };
  if (raw.length > MAX_STEPS) return { error: `máximo ${MAX_STEPS} pasos; se recibieron ${raw.length}` };

  const steps: PlanStep[] = [];
  for (const [i, s] of raw.entries()) {
    const n = i + 1;
    if (!isRecord(s)) return { error: `paso ${n}: no es un objeto` };
    const goal = nonEmptyString(s.goal);
    if (!goal) return { error: `paso ${n}: 'goal' vacío` };
    const route = s.suggested_mcp;
    if (!isExecutableRoute(route)) {
      return { error: `paso ${n}: suggested_mcp ${JSON.stringify(route)} inválido; debe ser uno de ${EXECUTABLE_ROUTES.join(", ")}` };
    }
    const expected = nonEmptyString(s.expected_outcome);
    if (!expected) return { error: `paso ${n}: 'expected_outcome' vacío` };

    steps.push({ id: `s${firstNumber + i}`, instruction: goal, route, expectedOutcome: expected });
  }
  return { steps };
}

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Validation<T> => ({ ok: true, value });
const fail = (error: string): Validation<never> => ({ ok: false, error });

const TRUNCATED = "la salida se truncó por el límite de tokens";
const NOT_JSON = "la respuesta no es un objeto JSON válido";

// ============================================================
// Motor
// ============================================================

const BASE_TEMPERATURE = 0.1;
const RETRY_TEMPERATURE = 0.3;
const RETRY_TOKEN_FACTOR = 1.5;
/** Mínimo de tokens de salida que debe quedar libre en el contexto. */
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

interface ValidatedDispatch<T> {
  stage: string;
  system: string;
  /** Recibe el error del intento anterior (undefined en el primero). */
  user: (previousError?: string) => string;
  json: boolean;
  schema?: JsonSchema;
  maxTokens: number;
  thinking: boolean;
  /** Thinking en el reintento; por defecto el mismo. */
  retryThinking?: boolean;
  signal?: AbortSignal;
  validate: (res: QwenDispatchResult, isLastAttempt: boolean) => Validation<T>;
}

export class QwenEngine implements ILLMClient {
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
        const msg = (err instanceof Error ? err.message : String(err)).replace(/\r?\n/g, " ").slice(0, 160);
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

  /** Una petición de inferencia. No valida el contenido. */
  private async dispatchPrompt(o: DispatchOptions): Promise<QwenDispatchResult> {
    const config = ConfigManager.getConfig();
    const url = this.resolveUrl(config.qwenUrl);

    // Guarda de contexto: Ollama recorta en silencio el prompt que no cabe y puede perder el SYSTEM.
    const promptEstimate = estimateTokens(o.system) + estimateTokens(o.user);
    const available = config.qwenNumCtx - promptEstimate;
    if (available < MIN_COMPLETION_TOKENS) {
      throw new LLMValidationError(
        `El prompt de '${o.stage}' (~${promptEstimate} tokens) no deja espacio de salida en el contexto de ${config.qwenNumCtx} tokens.`
      );
    }
    const maxTokens = Math.min(o.maxTokens, available);
    if (maxTokens < o.maxTokens) {
      console.warn(`[Qwen] stage=${o.stage} max_tokens reducido ${o.maxTokens} -> ${maxTokens} por límite de contexto (${config.qwenNumCtx}).`);
    }

    const body: Record<string, unknown> = {
      model: config.qwenModel,
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
    const rawInput = JSON.stringify(body, null, 2);

    console.log(`[Qwen → SEND] stage=${o.stage} system=${JSON.stringify(o.system).slice(0, 200)} user=${JSON.stringify(o.user).slice(0, 300)}`);

    const t0 = Date.now();
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
          err
        );
      }
      throw err; // RequestAbortedError
    }

    if (!result.ok) {
      throw new LLMServiceUnavailableError(`HTTP ${result.status} (${result.statusText}): ${result.text.slice(0, 300)}`);
    }

    let data: unknown;
    try {
      data = JSON.parse(result.text);
    } catch {
      throw new LLMValidationError("La respuesta de Qwen no es un JSON legible.", { rawInput, rawOutput: result.text });
    }

    const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
    const message = isRecord(choice) && isRecord(choice.message) ? choice.message : undefined;
    const content = typeof message?.content === "string" ? message.content : "";
    const finishReason = isRecord(choice) && typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown";
    const usage = isRecord(data) && isRecord(data.usage) ? data.usage : {};
    const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
    const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
    const truncated = finishReason === "length";

    console.log(`[Qwen ← RECV] stage=${o.stage} raw=${result.text.slice(0, 400)}`);
    console.log(
      `[Qwen] stage=${o.stage} tokens=(in=${promptTokens}, out=${completionTokens}, max=${maxTokens}) finish_reason=${finishReason}${truncated ? " [LENGTH_EXCEEDED]" : ""} thinking=${o.thinking ? "yes" : "no"} duration=${Date.now() - t0}ms`
    );
    if (promptTokens + completionTokens >= config.qwenNumCtx) {
      console.warn(`[Qwen] stage=${o.stage} agotó el contexto (${promptTokens + completionTokens}/${config.qwenNumCtx}); el servidor pudo recortar el prompt.`);
    }

    return { content, truncated, rawInput, rawOutput: result.text };
  }

  /**
   * Petición + validación con la política unificada de salida inválida: un reintento con el error
   * previo en el prompt, 1.5x tokens y temperatura 0.3. Si vuelve a fallar, LLMValidationError con el crudo.
   */
  private async dispatchValidated<T>(o: ValidatedDispatch<T>): Promise<{ value: T; res: QwenDispatchResult }> {
    let previousError: string | undefined;
    let last: QwenDispatchResult | undefined;

    for (let attempt = 0; attempt <= LLM_INVALID_OUTPUT_RETRIES; attempt++) {
      const retry = attempt > 0;
      const res = await this.dispatchPrompt({
        stage: o.stage,
        system: o.system,
        user: o.user(previousError),
        json: o.json,
        schema: o.schema,
        maxTokens: retry ? Math.ceil(o.maxTokens * RETRY_TOKEN_FACTOR) : o.maxTokens,
        thinking: retry ? (o.retryThinking ?? o.thinking) : o.thinking,
        temperature: retry ? RETRY_TEMPERATURE : BASE_TEMPERATURE,
        signal: o.signal,
      });
      last = res;

      const v = o.validate(res, attempt === LLM_INVALID_OUTPUT_RETRIES);
      if (v.ok) return { value: v.value, res };
      else {
        previousError = v.error;
        console.warn(`[Qwen] ${o.stage}: salida inválida (${v.error}); intento ${attempt + 1}/${LLM_INVALID_OUTPUT_RETRIES + 1}`);
      }
    }

    throw new LLMValidationError(
      `${o.stage}: ${previousError}`,
      last ? { rawInput: last.rawInput, rawOutput: last.rawOutput } : undefined
    );
  }

  /** Etapa 3: argumentos de tool, validados contra el inputSchema real. */
  async generateArguments(data: ArgumentPromptData, signal?: AbortSignal): Promise<ArgumentsGenerationResult> {
    return this.executeStage("generateArguments", async () => {
      const inputSchema = data.tool.inputSchema;
      const required = inputSchema.required ?? [];
      const userPrompt = PROMPTS.ARGUMENTS.buildUserPrompt(data);

      const { value, res } = await this.dispatchValidated<Record<string, unknown>>({
        stage: "arguments",
        system: PROMPTS.ARGUMENTS.SYSTEM,
        user: (prev) => userPrompt + retryNote(prev),
        json: true,
        maxTokens: ConfigManager.getConfig().qwenMaxTokens.arguments,
        thinking: false,
        signal,
        validate: (r) => {
          if (r.truncated) return fail(TRUNCATED);
          const parsed = parseJsonObject(r.content);
          if (!parsed) return fail(NOT_JSON);
          // null en un parámetro opcional equivale a "no usado".
          for (const k of Object.keys(parsed)) {
            if (parsed[k] === null && !required.includes(k)) delete parsed[k];
          }
          const problem = validateArgs(parsed, inputSchema);
          return problem ? fail(problem) : ok(parsed);
        },
      });

      return { args: value, rawInput: res.rawInput, rawOutput: res.rawOutput };
    });
  }

  /** Etapa 6: respuesta final en texto libre. */
  async generateFinalResponse(data: FinalResponsePromptData, signal?: AbortSignal): Promise<FinalResponseResult> {
    return this.executeStage("generateFinalResponse", async () => {
      const config = ConfigManager.getConfig();
      const userPrompt = PROMPTS.FINAL_RESPONSE.buildUserPrompt(data);

      const { value, res } = await this.dispatchValidated<string>({
        stage: "final_response",
        system: PROMPTS.FINAL_RESPONSE.SYSTEM,
        user: (prev) => userPrompt + retryNote(prev),
        json: false,
        maxTokens: config.qwenMaxTokens.final,
        thinking: config.thinking,
        retryThinking: false, // un final vacío suele ser thinking que agotó el presupuesto
        signal,
        validate: (r, isLast) => {
          const text = stripThink(r.content);
          if (!text) return fail("salida vacía");
          if (!r.truncated) return ok(text);
          return isLast ? ok(`${text}\n\n[Respuesta truncada por el límite de tokens]`) : fail(TRUNCATED);
        },
      });

      return { response: value, rawInput: res.rawInput, rawOutput: res.rawOutput };
    });
  }

  /** Modo PLAN: plan inicial. `steps: []` es válido (la solicitud no requiere herramientas). */
  async generatePlan(
    userMessage: string,
    chatContext?: string,
    signal?: AbortSignal,
    compactCatalog?: string,
    modificationFeedback?: string,
    existingPlanSummary?: string
  ): Promise<Plan> {
    return this.executeStage("generatePlan", async () => {
      const userPrompt = PROMPTS.PLAN.buildUserPrompt(
        userMessage,
        chatContext,
        compactCatalog || buildCompactCatalog(),
        modificationFeedback,
        existingPlanSummary
      );

      const { value, res } = await this.dispatchValidated<{ objective: string; steps: PlanStep[] }>({
        stage: "plan",
        system: PROMPTS.PLAN.SYSTEM,
        user: (prev) => userPrompt + retryNote(prev),
        json: true,
        schema: PLAN_JSON_SCHEMA,
        maxTokens: ConfigManager.getConfig().qwenMaxTokens.plan,
        thinking: true,
        signal,
        validate: (r) => {
          if (r.truncated) return fail(TRUNCATED);
          const parsed = parseJsonObject(r.content);
          if (!parsed) return fail(NOT_JSON);
          const parsedSteps = parsePlanSteps(parsed.steps, 1, true);
          if ("error" in parsedSteps) return fail(parsedSteps.error);
          return ok({ objective: nonEmptyString(parsed.objective) ?? userMessage, steps: parsedSteps.steps });
        },
      });

      return { objective: value.objective, steps: value.steps, rawInput: res.rawInput, rawOutput: res.rawOutput };
    });
  }

  /** Modo PLAN: replan localizado. Exige `action`; "continue" exige pasos válidos. */
  async replan(data: ReplanPromptData, signal?: AbortSignal): Promise<ReplanResult> {
    return this.executeStage("replan", async () => {
      const userPrompt = PROMPTS.REPLAN.buildUserPrompt(data);

      const { value, res } = await this.dispatchValidated<
        { action: "abort"; reason: string } | { action: "continue"; objective: string; steps: PlanStep[] }
      >({
        stage: "replan",
        system: PROMPTS.REPLAN.SYSTEM,
        user: (prev) => userPrompt + retryNote(prev),
        json: true,
        schema: REPLAN_JSON_SCHEMA,
        maxTokens: ConfigManager.getConfig().qwenMaxTokens.replan,
        thinking: true,
        signal,
        validate: (r) => {
          if (r.truncated) return fail(TRUNCATED);
          const parsed = parseJsonObject(r.content);
          if (!parsed) return fail(NOT_JSON);
          if (parsed.action === "abort") {
            return ok({ action: "abort" as const, reason: nonEmptyString(parsed.reason) ?? "Replan decidió abortar." });
          }
          if (parsed.action !== "continue") return fail(`'action' debe ser "continue" o "abort"`);
          const parsedSteps = parsePlanSteps(parsed.steps, data.nextStepNumber, false);
          if ("error" in parsedSteps) return fail(parsedSteps.error);
          return ok({
            action: "continue" as const,
            objective: nonEmptyString(parsed.objective) ?? data.goal,
            steps: parsedSteps.steps,
          });
        },
      });

      if (value.action === "abort") {
        return { action: "abort", reason: value.reason, rawInput: res.rawInput, rawOutput: res.rawOutput };
      }
      return {
        plan: { objective: value.objective, steps: value.steps, rawInput: res.rawInput, rawOutput: res.rawOutput },
        rawInput: res.rawInput,
        rawOutput: res.rawOutput,
      };
    });
  }

  /**
   * Verificación semántica de etapa. Si Qwen no produce un veredicto válido tras el reintento, el resultado es
   * `recoverable_deviation`: la señal de Eos nunca sustituye al juez semántico.
   */
  async verifyStage(data: StageVerificationPromptData, signal?: AbortSignal): Promise<StageVerificationResult> {
    return this.executeStage("verifyStage", async () => {
      const userPrompt = PROMPTS.STAGE_VERIFICATION.buildUserPrompt(data);

      try {
        const { value, res } = await this.dispatchValidated<Omit<StageVerificationResult, "rawInput" | "rawOutput">>({
          stage: "verify_stage",
          system: PROMPTS.STAGE_VERIFICATION.SYSTEM,
          user: (prev) => userPrompt + retryNote(prev),
          json: true,
          schema: STAGE_VERIFICATION_JSON_SCHEMA,
          maxTokens: ConfigManager.getConfig().qwenMaxTokens.verify,
          thinking: false,
          signal,
          validate: (r) => {
            if (r.truncated) return fail(TRUNCATED);
            const parsed = parseJsonObject(r.content);
            if (!parsed) return fail(NOT_JSON);
            const status = (STAGE_STATUSES as readonly unknown[]).includes(parsed.status)
              ? (parsed.status as StageVerificationStatus)
              : undefined;
            if (!status) return fail(`'status' debe ser uno de ${STAGE_STATUSES.join(", ")}`);
            const reason = nonEmptyString(parsed.reason) ?? "Sin detalle.";
            const question = nonEmptyString(parsed.question_for_user);
            if (status === "insufficient_info" && !question) {
              return ok({
                status: "recoverable_deviation" as const,
                reason: `${reason} (se requería información del usuario, pero no se formuló la pregunta)`,
              });
            }
            return ok({ status, reason, questionForUser: question });
          },
        });
        return { ...value, rawInput: res.rawInput, rawOutput: res.rawOutput };
      } catch (err) {
        if (!(err instanceof LLMValidationError)) throw err;
        return {
          status: "recoverable_deviation",
          reason: `La verificación semántica no produjo un veredicto válido: ${err.message}`,
          rawInput: err.raw?.rawInput,
          rawOutput: err.raw?.rawOutput,
        };
      }
    });
  }
}