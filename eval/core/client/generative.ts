/**
 * eval/core/client/generative.ts
 *
 * Cliente de las etapas generativas (plan, arguments, final, question, pending).
 * Envía exactamente el body que envía producción (orden de claves incluido), con su reserva de contexto: `max_tokens` se recorta
 * a lo que cabe en `qwenNumCtx` y un prompt sin margen de salida no se envía (`reserveCompletionTokens`).
 */

import { chatCompletionsUrl, ConfigManager, estimateTokens, MIN_COMPLETION_TOKENS, postJson as prodPostJson, TransportError } from "../contract.ts";
import type { ToolInputSchema } from "../contract.ts";
import type { GenerativeRequest } from "../types.ts";

/** Prefijo del error de un prompt que no deja margen de salida: no se envió nada y repetir no sirve. No es un fallo de transporte. */
export const CONTEXT_OVERFLOW_PREFIX = "context_overflow:";

/**
 * `max_tokens` que producción pediría (`min(maxTokens, numCtx − tokens del prompt)`), o `null` si no queda margen de
 * `MIN_COMPLETION_TOKENS` y producción lanzaría `LLMValidationError` sin enviar.
 */
export function reserveCompletionTokens(req: GenerativeRequest, numCtx: number): number | null {
  const available = numCtx - (estimateTokens(req.system) + estimateTokens(req.user));
  if (available < MIN_COMPLETION_TOKENS) return null;
  return Math.min(req.maxTokens, available);
}


/** Lo que se enviaría (o se envió): lo imprime `--dry-run` y lo usa el mock. */
export interface PreparedRequest {
  url: string;
  body: Record<string, unknown>;
}

export type PostResult =
  | { ok: true; text: string; durationMs: number }
  | { ok: false; error: string; durationMs: number };

/**
 * ¿`error` es un fallo del transporte (timeout, red o HTTP)? Es el contrato entre los clientes y el runner: los textos los
 * fijan `postJson` y `createGenerativeClient`, y quien clasifique un error debe usar esta función en vez de comparar textos.
 */
export function isTransportError(error: string): boolean {
  return error === "timeout" || error.startsWith("network:") || error.startsWith("http_");
}

/** Incluye errores de transporte y errores fatales de configuración (`config:`). */
export function isFatalClientError(error: string): boolean {
  return isTransportError(error) || error.startsWith("config:");
}

/**
 * Delega en `src/core/models/transport.ts` (`postJson`) para heredar la política de timeout y reintento único en red/503.
 * Traduce la respuesta al contrato `{ ok, text | error, durationMs }` (`timeout` / `network: …` / `http_<status>`).
 */
export async function postJson(url: string, body: unknown, timeoutMs: number): Promise<PostResult> {
  const start = Date.now();
  try {
    const res = await prodPostJson({ url, body: JSON.stringify(body), timeoutMs });
    const durationMs = Date.now() - start;
    if (!res.ok) return { ok: false, error: `http_${res.status}`, durationMs };
    return { ok: true, text: res.text, durationMs };
  } catch (e) {
    const durationMs = Date.now() - start;
    if (e instanceof TransportError) {
      return { ok: false, error: e.kind === "timeout" ? "timeout" : `network: ${e.message}`, durationMs };
    }
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}`, durationMs };
  }
}

/** URL de chat con la regla de producción (`chatCompletionsUrl`). Lanza si la URL está vacía o apunta a un endpoint no soportado. */
export function resolveUrl(rawUrl: string): string {
  const result = chatCompletionsUrl(rawUrl);
  if (result.ok) return result.url;
  throw new Error(
    result.reason === "empty"
      ? "La URL de Qwen no está configurada. Configúrela con --url o en jarvis-config.json."
      : `URL generativa no soportada: '${rawUrl}' (use la base del servidor o /v1/chat/completions).`,
  );
}

export interface GenerativeClientConfig {
  url: string;
  model: string;
  /** Contexto del servidor (`qwenNumCtx`); por defecto el de la configuración de producción. */
  numCtx?: number;
}

/** Datos del caso que el cliente real ignora y el mock usa para fabricar una salida válida. */
export interface GenerativeCallContext {
  toolSchema?: ToolInputSchema;
  /** Etapa y `expect` del caso (ya con la variante aplicada): solo los usa el mock oráculo. */
  stage?: string;
  expect?: unknown;
}

export type GenerativeCallResult =
  | {
    ok: true;
    /** `choices[0].message.content ?? ""` (crudo, con `<think>` si viene). */
    rawOutput: string;
    finishReason?: string;
    tokens?: { prompt?: number; completion?: number; total?: number };
    /** true si los tokens son una estimación (mock) y no los midió el modelo. */
    tokensEstimated?: boolean;
    durationMs: number;
  }
  | { ok: false; error: string; durationMs: number };

export interface GenerativeClient {
  prepare(req: GenerativeRequest): PreparedRequest;
  call(req: GenerativeRequest, timeoutMs: number, ctx?: GenerativeCallContext): Promise<GenerativeCallResult>;
}

/** Body de producción. Orden de claves: model, messages, temperature, max_tokens, stream, reasoning_effort, keep_alive, response_format. */
export function buildGenerativeBody(model: string, req: GenerativeRequest, maxTokens: number = req.maxTokens): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    temperature: req.temperature,
    max_tokens: maxTokens,
    stream: false,
    reasoning_effort: req.reasoningEffort ?? (req.thinking ? "low" : "none"),
    // Como producción: mantiene el modelo cargado (sin él, la primera llamada tras una descarga mide también la recarga).
    keep_alive: ConfigManager.getConfig().modelKeepAlive,
  };

  if (req.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: req.schemaName ?? "plan", strict: false, schema: req.schema },
    };
  } else if (req.json) {
    body.response_format = { type: "json_object" };
  }

  return body;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function parseGenerativeResponse(
  text: string,
): { rawOutput: string; finishReason?: string; tokens?: { prompt?: number; completion?: number; total?: number } } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as {
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
    usage?: Record<string, unknown>;
  };
  const choice = d.choices?.[0];
  const content = choice?.message?.content;
  const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined;

  let tokens: { prompt?: number; completion?: number; total?: number } | undefined;
  if (d.usage && typeof d.usage === "object") {
    tokens = {
      prompt: num(d.usage.prompt_tokens),
      completion: num(d.usage.completion_tokens),
      total: num(d.usage.total_tokens),
    };
  }

  return { rawOutput: typeof content === "string" ? content : "", finishReason, tokens };
}

export function createGenerativeClient(cfg: GenerativeClientConfig): GenerativeClient {
  // Falla al crear el cliente si la URL es inválida (error de configuración).
  const url = resolveUrl(cfg.url);

  // Closure en vez de `this.prepare`: `const { call } = client` no rompe.
  const numCtx = cfg.numCtx ?? ConfigManager.getConfig().qwenNumCtx;
  // Sin margen de salida, el body conserva `maxTokens` (`call` no lo envía: ver `CONTEXT_OVERFLOW_PREFIX`).
  const prepare = (req: GenerativeRequest): PreparedRequest => ({
    url,
    body: buildGenerativeBody(cfg.model, req, reserveCompletionTokens(req, numCtx) ?? req.maxTokens),
  });

  return {
    prepare,
    async call(req, timeoutMs) {
      const reserved = reserveCompletionTokens(req, numCtx);
      if (reserved === null) {
        return {
          ok: false,
          error: `${CONTEXT_OVERFLOW_PREFIX} el prompt (~${estimateTokens(req.system) + estimateTokens(req.user)} tokens) no deja espacio de salida en el contexto de ${numCtx} tokens; producción no lo enviaría.`,
          durationMs: 0,
        };
      }
      const res = await postJson(url, buildGenerativeBody(cfg.model, req, reserved), timeoutMs);
      if (!res.ok) return res;
      const parsed = parseGenerativeResponse(res.text);
      if (!parsed) {
        return { ok: false, error: "invalid_response: la respuesta no es JSON válido", durationMs: res.durationMs };
      }
      return { ok: true, ...parsed, durationMs: res.durationMs };
    },
  };
}