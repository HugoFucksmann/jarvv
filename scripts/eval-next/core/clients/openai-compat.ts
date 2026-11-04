/**
 * scripts/eval-next/core/clients/openai-compat.ts
 *
 * Cliente para modelos generativos vía endpoint compatible con OpenAI/Ollama (/v1/chat/completions).
 * Reutiliza el transporte oficial de producción (src/core/llmTransport.ts).
 */

import { postJson } from "../../../../src/core/llmTransport.ts";
import type { GenerativeModelRequest, ModelRequest, ModelResponse } from "../types.ts";
import type { ModelClient, ModelClientConfig } from "./types.ts";

export class OpenAiCompatClient implements ModelClient {
  readonly name = "OpenAiCompatClient";
  private readonly url: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly apiKey?: string;

  constructor(cfg: ModelClientConfig = {}) {
    this.url = cfg.url || process.env.LLM_URL || "http://127.0.0.1:11434";
    this.model = cfg.model || process.env.LLM_MODEL || "qwen3.5:4b";
    this.timeoutMs = cfg.timeoutMs || 120_000;
    this.apiKey = cfg.apiKey || process.env.OPENAI_API_KEY;
  }

  async call(request: ModelRequest): Promise<ModelResponse> {
    if (request.type !== "generative") {
      throw new Error(`OpenAiCompatClient solo soporta peticiones de tipo 'generative'. Se recibió '${request.type}'.`);
    }

    const genReq = request as GenerativeModelRequest;
    const endpoint = `${this.url.replace(/\/+$/, "")}/v1/chat/completions`;

    const messages = [
      { role: "system", content: genReq.system },
      { role: "user", content: genReq.user },
    ];

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0.1,
      stream: false,
    };

    if (genReq.maxTokens) {
      body.max_tokens = genReq.maxTokens;
    }

    if (genReq.json) {
      if (genReq.schema) {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: "response_schema",
            strict: true,
            schema: genReq.schema,
          },
        };
      } else {
        body.response_format = { type: "json_object" };
      }
    }

    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const t0 = Date.now();
    const res = await postJson({
      url: endpoint,
      body: JSON.stringify(body),
      timeoutMs: this.timeoutMs,
      headers,
    });

    const durationMs = Date.now() - t0;
    if (!res.ok) {
      throw new Error(`OpenAI HTTP error: ${res.status} ${res.statusText} - ${res.text}`);
    }

    interface OpenAiResponse {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    }

    let parsed: OpenAiResponse = {};
    try {
      parsed = JSON.parse(res.text);
    } catch {
      throw new Error(`Invalid JSON response from OpenAI API: ${res.text}`);
    }

    const choice = parsed.choices?.[0];
    const rawOutput = choice?.message?.content ?? "";
    const finishReason = choice?.finish_reason;

    return {
      rawOutput,
      durationMs,
      finishReason,
      tokens: parsed.usage
        ? {
            prompt: parsed.usage.prompt_tokens,
            completion: parsed.usage.completion_tokens,
            total: parsed.usage.total_tokens,
          }
        : undefined,
    };
  }
}

