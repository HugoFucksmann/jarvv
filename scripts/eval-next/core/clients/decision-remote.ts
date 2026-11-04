/**
 * scripts/eval-next/core/clients/decision-remote.ts
 *
 * Cliente para modelos de decisión rápida (D3 / Eos).
 * Soporta endpoint local (/v1/systemone o /v1/decide) o remoto.
 */

import { postJson } from "../../../../src/core/llmTransport.ts";
import type { DecisionModelRequest, ModelRequest, ModelResponse } from "../types.ts";
import type { ModelClient, ModelClientConfig } from "./types.ts";

export class DecisionRemoteClient implements ModelClient {
  readonly name = "DecisionRemoteClient";
  private readonly url: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly apiKey?: string;
  private readonly backend: "d3" | "eos";

  constructor(cfg: ModelClientConfig = {}) {
    this.backend = (cfg.options?.backend as "d3" | "eos") || "d3";
    this.url =
      cfg.url ||
      process.env.DECISION_URL ||
      (this.backend === "eos" ? "http://127.0.0.1:8765" : "http://127.0.0.1:11434");
    this.model = cfg.model || (this.backend === "eos" ? "decision-2.0-eos" : "d3:2b");
    this.timeoutMs = cfg.timeoutMs || 30_000;
    this.apiKey = cfg.apiKey || process.env.D3_API_KEY;
  }

  async call(request: ModelRequest): Promise<ModelResponse> {
    if (request.type !== "decision") {
      throw new Error(`DecisionRemoteClient solo soporta peticiones de tipo 'decision'. Se recibió '${request.type}'.`);
    }

    const decReq = request as DecisionModelRequest;
    const base = this.url.replace(/\/+$/, "");
    const endpoint =
      this.backend === "eos" ? `${base}/v1/decide` : `${base}/v1/systemone`;

    const body: Record<string, unknown> = {
      state: decReq.state,
      questions: decReq.questions,
    };

    if (this.backend === "d3") {
      body.model = this.model;
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
      throw new Error(`Decision remote error: ${res.status} ${res.statusText} - ${res.text}`);
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(res.text);
    } catch {
      // raw text
    }

    return {
      rawOutput: res.text,
      durationMs,
      finishReason: "stop",
      metadata: parsed,
    };
  }
}

