/**
 * eval/core/client/generative.ts
 *
 * Cliente de las etapas generativas (plan, arguments, final, question, pending).
 * Envía exactamente el body que envía producción (orden de claves incluido), con su reserva de contexto: `max_tokens` se recorta
 * a lo que cabe en `qwenNumCtx` y un prompt sin margen de salida no se envía (`reserveCompletionTokens`).
 */

/** Margen mínimo de salida (`MIN_COMPLETION_TOKENS` de producción, que no lo exporta). */
const MIN_COMPLETION_TOKENS = 256;

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

import { ConfigManager } from "../../../src/core/config.ts";
import { estimateTokens, LLM_TRANSPORT_BACKOFF_MS, LLM_TRANSPORT_RETRIES } from "../contract.ts";
import type { ToolInputSchema } from "../contract.ts";
import type { GenerativeRequest } from "../types.ts";

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

/**
 * POST JSON con `fetch` + `AbortController` (`setTimeout` ref'd). Reintento único en red o 503 (como producción), sin `Authorization`.
 * Errores: `timeout` / `network: …` / `http_<status>` (ver `isTransportError`).
 */
export async function postJson(url: string, body: unknown, timeoutMs: number): Promise<PostResult> {
  const start = Date.now();
  // Presupuesto total de la llamada: incluye el reintento y la espera (como `models/transport.ts`).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), timeoutMs);
  const signal = ctrl.signal;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
          signal,
        });
        const text = await res.text();
        if (!(res.status === 503 && attempt < LLM_TRANSPORT_RETRIES)) {
          const durationMs = Date.now() - start;
          if (!res.ok) return { ok: false, error: `http_${res.status}`, durationMs };
          return { ok: true, text, durationMs };
        }
        // 503: cae al backoff y reintenta.
      } catch (e) {
        if (signal.aborted || (e as { name?: string } | null)?.name === "TimeoutError") {
          return { ok: false, error: "timeout", durationMs: Date.now() - start };
        }
        if (attempt >= LLM_TRANSPORT_RETRIES) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: `network: ${msg}`, durationMs: Date.now() - start };
        }
      }
      // Reintento único (red o HTTP 503) tras 1 s; el timeout nunca se reintenta.
      await new Promise<void>((resolve) => {
        // Con el presupuesto ya agotado el evento `abort` no se repite: sin esto se esperaba el backoff entero y se inflaba la latencia.
        if (signal.aborted) return resolve();
        const onAbort = (): void => {
          clearTimeout(t);
          resolve();
        };
        const t = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, LLM_TRANSPORT_BACKOFF_MS);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  } finally {
    clearTimeout(timer);
  }
}

/** `resolveUrl` de producción. Lanza si la URL está vacía o apunta a un endpoint no soportado. */
export function resolveUrl(rawUrl: string): string {
  const base = rawUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("La URL de Qwen no está configurada. Configúrela con --url o en jarvis-config.json.");
  if (base.endsWith("/v1/chat/completions")) return base;
  if (base.endsWith("/generate") || base.endsWith("/api/chat")) {
    throw new Error(
      `URL generativa no soportada: '${rawUrl}' (use la base del servidor o /v1/chat/completions).`,
    );
  }
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
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

/** Body de producción. Orden de claves: model, messages, temperature, max_tokens, stream, reasoning_effort, response_format. */
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
      if (reserveCompletionTokens(req, numCtx) === null) {
        return {
          ok: false,
          error: `${CONTEXT_OVERFLOW_PREFIX} el prompt (~${estimateTokens(req.system) + estimateTokens(req.user)} tokens) no deja espacio de salida en el contexto de ${numCtx} tokens; producción no lo enviaría.`,
          durationMs: 0,
        };
      }
      const { body } = prepare(req);
      const res = await postJson(url, body, timeoutMs);
      if (!res.ok) return res;
      const parsed = parseGenerativeResponse(res.text);
      if (!parsed) {
        return { ok: false, error: "network: la respuesta no es JSON válido", durationMs: res.durationMs };
      }
      return { ok: true, ...parsed, durationMs: res.durationMs };
    },
  };
}