import { estimateTokens, postJson, TransportError } from "../../../../src/core/llmTransport.ts";

export interface LlmClientOptions {
  url?: string;
  model?: string;
  numCtx?: number;
  thinkingTimeoutMs?: number;
  defaultTimeoutMs?: number;
}
export type QwenClientOptions = LlmClientOptions;

export interface LlmInferencePayload {
  stage: string;
  system: string;
  user: string;
  json?: boolean;
  schema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  thinking?: boolean;
}
export type QwenInferencePayload = LlmInferencePayload;

export interface LlmInferenceResult {
  content: string;
  reasoning: string;
  /** max_tokens realmente enviado (tras el tope por contexto). */
  maxTokens: number;
  rawInput: string;
  rawOutput: string;
  promptTokens: number;
  completionTokens: number;
  finishReason: string;
  durationMs: number;
}
export type QwenInferenceResult = LlmInferenceResult;

const REASONING_EFFORT_THINKING = "low";
const REASONING_EFFORT_OFF = "none";
const DEFAULT_MAX_TOKENS = 2048;
/** Mínimo de tokens de salida que debe quedar libre en el contexto (igual que producción). */
const MIN_COMPLETION_TOKENS = 256;

export class LlmEvalClient {
  private url: string;
  private model: string;
  private numCtx: number;
  private thinkingTimeoutMs: number;
  private defaultTimeoutMs: number;

  constructor(opts?: LlmClientOptions) {
    const rawUrl = opts?.url || process.env.LLM_URL || process.env.QWEN_URL || "http://127.0.0.1:11434";
    this.url = this.formatUrl(rawUrl);
    this.model = opts?.model || process.env.LLM_MODEL || process.env.QWEN_MODEL || "qwen2.5:7b";
    this.numCtx = opts?.numCtx || (process.env.LLM_NUM_CTX || process.env.QWEN_NUM_CTX ? Number(process.env.LLM_NUM_CTX || process.env.QWEN_NUM_CTX) : 16384);
    this.thinkingTimeoutMs = opts?.thinkingTimeoutMs || 180000;
    this.defaultTimeoutMs = opts?.defaultTimeoutMs || 120000;
  }

  public get contextSize(): number {
    return this.numCtx;
  }

  private formatUrl(raw: string): string {
    const base = raw.trim().replace(/\/+$/, "");
    if (base.endsWith("/v1/chat/completions")) return base;
    return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  }

  public async infer(payload: QwenInferencePayload): Promise<QwenInferenceResult> {
    const thinking = payload.thinking ?? false;
    const timeoutMs = thinking ? this.thinkingTimeoutMs : this.defaultTimeoutMs;

    const promptEstimate = estimateTokens(payload.system) + estimateTokens(payload.user);
    const available = this.numCtx - promptEstimate;
    if (available < MIN_COMPLETION_TOKENS) {
      throw new Error(
        `El prompt de '${payload.stage}' (~${promptEstimate} tokens) no deja espacio de salida en el contexto de ${this.numCtx} tokens.`
      );
    }
    const maxTokens = Math.min(payload.maxTokens ?? DEFAULT_MAX_TOKENS, available);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: payload.system },
        { role: "user", content: payload.user },
      ],
      temperature: payload.temperature ?? 0.1,
      max_tokens: maxTokens,
      stream: false,
      reasoning_effort: thinking ? REASONING_EFFORT_THINKING : REASONING_EFFORT_OFF,
    };

    if (payload.schema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: payload.stage, strict: false, schema: payload.schema },
      };
    } else if (payload.json) {
      body.response_format = { type: "json_object" };
    }

    const rawInput = JSON.stringify(body, null, 2);
    const t0 = Date.now();

    try {
      const res = await postJson({
        url: this.url,
        body: JSON.stringify(body),
        timeoutMs,
      });

      const durationMs = Date.now() - t0;

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} (${res.statusText}): ${res.text.slice(0, 300)}`);
      }

      let data: Record<string, any>;
      try {
        data = JSON.parse(res.text) as Record<string, any>;
      } catch {
        throw new Error(`La respuesta del servidor no es JSON válido: ${res.text.slice(0, 300)}`);
      }

      const choice = data.choices?.[0] ?? {};
      const message = choice.message ?? {};
      const content = typeof message.content === "string" ? message.content : "";
      const reasoningRaw = message.reasoning ?? message.reasoning_content;
      const reasoning = typeof reasoningRaw === "string" ? reasoningRaw : "";
      const finishReason = choice.finish_reason || "unknown";
      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;

      return {
        content,
        reasoning,
        maxTokens,
        rawInput,
        rawOutput: res.text,
        promptTokens,
        completionTokens,
        finishReason,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - t0;
      if (err instanceof TransportError) {
        throw new Error(`[LlmEval TransportError] ${err.message} (duración: ${durationMs}ms)`);
      }
      throw err;
    }
  }
}

export const QwenEvalClient = LlmEvalClient;
export type QwenEvalClient = LlmEvalClient;