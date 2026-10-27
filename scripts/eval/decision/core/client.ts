import http from "node:http";
import type { DecisionPayload, DecisionModelResponse } from "./types.ts";

export interface ClientConfig {
  backend: "d3" | "eos";
  url?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  options?: Record<string, any>;
}

export async function callDecisionModel(
  config: ClientConfig,
  payload: DecisionPayload
): Promise<{ rawOutput: string; parsed: DecisionModelResponse; latencyMs: number }> {
  const startedAt = Date.now();
  const backend = config.backend;
  const timeoutMs = config.timeoutMs || 30000;

  let urlStr: string;
  let bodyData: any;

  if (backend === "d3") {
    const baseUrl = config.url || "http://127.0.0.1:11434";
    urlStr = baseUrl.endsWith("/v1/systemone") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/v1/systemone`;
    bodyData = {
      model: config.model || "d3:2b",
      state: payload.state,
      questions: payload.questions,
      options: {
        ...(config.options || {}),
      },
    };
  } else {
    // Eos (0.8B) en FastAPI
    const baseUrl = config.url || "http://127.0.0.1:8765";
    urlStr = baseUrl.endsWith("/v1/decide") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/v1/decide`;
    bodyData = {
      state: payload.state,
      questions: payload.questions,
    };
  }

  // Si es HTTPS o tiene API Key (vía remota), usamos fetch nativo
  if (urlStr.startsWith("https://") || config.apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }

      const res = await fetch(urlStr, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyData),
        signal: controller.signal,
      });

      const body = await res.text();
      const latencyMs = Date.now() - startedAt;

      if (res.ok) {
        const parsed = JSON.parse(body) as DecisionModelResponse;
        return { rawOutput: body, parsed, latencyMs };
      } else {
        throw new Error(`HTTP ${res.status} from ${backend}: ${body.slice(0, 200)}`);
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        throw new Error(`Timeout (${timeoutMs}ms) calling ${backend} at ${urlStr}`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const data = JSON.stringify(bodyData);
  const u = new URL(urlStr);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          const latencyMs = Date.now() - startedAt;
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(body) as DecisionModelResponse;
              resolve({ rawOutput: body, parsed, latencyMs });
            } catch (e) {
              reject(new Error(`JSON decode error from ${backend}: ${body.slice(0, 200)}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode} from ${backend}: ${body.slice(0, 200)}`));
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout (${timeoutMs}ms) calling ${backend} at ${urlStr}`));
    });

    req.on("error", (e) => {
      reject(e);
    });

    req.write(data);
    req.end();
  });
}
