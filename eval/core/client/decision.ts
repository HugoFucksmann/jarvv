/**
 * eval/core/client/decision.ts
 *
 * Cliente de las etapas de decisión (route, tool_choice, args_review, result_verification).
 */

import { ConfigManager } from "../../../src/core/config.ts";
import { estimateTokens } from "../contract.ts";
import type { DecisionRequest } from "../types.ts";
import { postJson } from "./generative.ts";
import type { PreparedRequest } from "./generative.ts";

/** `decisionMaxContext` de la configuración de producción: tokens estimados máximos de `{state, questions}`. */
export const DECISION_MAX_CONTEXT = ConfigManager.getConfig().decisionMaxContext;

export interface DecisionClientConfig {
  url: string;
  /** Solo d3 lo envía en el body. */
  model?: string;
}

export type DecisionCallResult =
  | {
    ok: true;
    /** Cuerpo de respuesta como texto. */
    rawOutput: string;
    /** Estimados (caracteres/3): d3 no devuelve `usage`. */
    tokens: { prompt: number; completion: number; total: number };
    tokensEstimated: true;
    durationMs: number;
  }
  | { ok: false; error: string; durationMs: number };

/** Etapa y `expect` del caso: el cliente real los ignora; solo los usa el mock oráculo. */
export interface DecisionCallContext {
  stage?: string;
  expect?: unknown;
}

export interface DecisionClient {
  prepare(req: DecisionRequest): PreparedRequest;
  call(req: DecisionRequest, timeoutMs: number, ctx?: DecisionCallContext): Promise<DecisionCallResult>;
}

/** Tokens estimados de lo que producción mide contra `decisionMaxContext`. */
export function estimateDecisionPromptTokens(req: DecisionRequest): number {
  return estimateTokens(JSON.stringify({ state: req.state, questions: req.questions }));
}

export function createDecisionClient(cfg: DecisionClientConfig): DecisionClient {
  const base = cfg.url.trim().replace(/\/+$/, "");

  // Closure en vez de `this.prepare`: `const { call } = client` ya no rompe.
  const prepare = (req: DecisionRequest): PreparedRequest => {
    const url = base.endsWith("/v1/systemone") ? base : `${base}/v1/systemone`;
    return { url, body: { model: cfg.model, state: req.state, questions: req.questions } };
  };

  return {
    prepare,
    async call(req, timeoutMs) {
      // Como `Decision20Engine.systemOne`: sin URL configurada no se envía nada (error de configuración, no de red).
      if (!base) {
        return { ok: false, error: "config: la URL de Decision 2.0 no está configurada (--decision-url o jarvis-config.json).", durationMs: 0 };
      }
      const { url, body } = prepare(req);
      const res = await postJson(url, body, timeoutMs);
      if (!res.ok) return res;
      const prompt = estimateDecisionPromptTokens(req);
      const completion = estimateTokens(res.text);
      return {
        ok: true,
        rawOutput: res.text,
        tokens: { prompt, completion, total: prompt + completion },
        tokensEstimated: true,
        durationMs: res.durationMs,
      };
    },
  };
}