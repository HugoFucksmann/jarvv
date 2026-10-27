import { postJson, TransportError } from "../../../src/core/llmTransport.ts";

export interface QwenClientOptions {
  url?: string;
  model?: string;
  numCtx?: number;
  thinkingTimeoutMs?: number;
  defaultTimeoutMs?: number;
}

export interface QwenInferencePayload {
  stage: string;
  system: string;
  user: string;
  json?: boolean;
  schema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  thinking?: boolean;
}

export interface QwenInferenceResult {
  content: string;
  rawInput: string;
  rawOutput: string;
  promptTokens: number;
  completionTokens: number;
  finishReason: string;
  durationMs: number;
}

export class QwenEvalClient {
  private url: string;
  private model: string;
  private numCtx: number;
  private thinkingTimeoutMs: number;
  private defaultTimeoutMs: number;

  constructor(opts?: QwenClientOptions) {
    const rawUrl = opts?.url || process.env.QWEN_URL || "http://127.0.0.1:11434";
    this.url = this.formatUrl(rawUrl);
    this.model = opts?.model || process.env.QWEN_MODEL || "qwen2.5:7b";
    this.numCtx = opts?.numCtx || (process.env.QWEN_NUM_CTX ? Number(process.env.QWEN_NUM_CTX) : 16384);
    this.thinkingTimeoutMs = opts?.thinkingTimeoutMs || 180000;
    this.defaultTimeoutMs = opts?.defaultTimeoutMs || 90000;
  }

  private formatUrl(raw: string): string {
    const base = raw.trim().replace(/\/+$/, "");
    if (base.endsWith("/v1/chat/completions")) return base;
    return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  }

  public async infer(payload: QwenInferencePayload): Promise<QwenInferenceResult> {
    const thinking = payload.thinking ?? false;
    const timeoutMs = thinking ? this.thinkingTimeoutMs : this.defaultTimeoutMs;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: payload.system },
        { role: "user", content: payload.user },
      ],
      temperature: payload.temperature ?? 0.1,
      max_tokens: payload.maxTokens ?? 2048,
      stream: false,
      reasoning_effort: thinking ? "low" : "none",
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

      const data = JSON.parse(res.text) as Record<string, any>;
      const choice = data.choices?.[0] || {};
      const content = choice.message?.content || "";
      const finishReason = choice.finish_reason || "unknown";
      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;

      return {
        content,
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
        throw new Error(`[QwenEval TransportError] ${err.message} (duración: ${durationMs}ms)`);
      }
      throw err;
    }
  }
}
