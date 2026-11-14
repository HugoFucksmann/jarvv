/**
 * JARVIS Core — Precalentamiento de los modelos al arrancar.
 *
 * Una consulta mínima a cada modelo (decisión y generativo) carga sus pesos en la GPU y deja corriendo el `keep_alive` de `modelKeepAlive`: la primera tarea no paga la
 * carga en frío (unos 2 s con los archivos en el caché del sistema, hasta ~12 s en frío total). Es una optimización: un fallo (Ollama apagado, modelo ausente) se registra y
 * no detiene nada; la primera tarea real lo volverá a ver. No pasa por el motor ni por el contexto de ninguna tarea.
 */

import type { ConfigSource } from "../config.ts";
import { buildDecisionRequest } from "./decision.ts";
import { errorMessage } from "../utils.ts";

type FetchFn = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

const JSON_HEADERS = { "content-type": "application/json" };

/** URL de chat del generativo: la base del servidor o `/v1/chat/completions` ya completa (como `QwenEngine.resolveUrl`). */
export function chatUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1/chat/completions") ? trimmed : `${trimmed}/v1/chat/completions`;
}

async function ping(label: string, url: string, body: string, timeoutMs: number, fetchFn: FetchFn): Promise<void> {
  const t0 = Date.now();
  try {
    const res = await fetchFn(url, { method: "POST", headers: JSON_HEADERS, body, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`[Warmup] ${label} listo (${Date.now() - t0} ms).`);
  } catch (error) {
    console.warn(`[Warmup] ${label} no se pudo precalentar: ${errorMessage(error)}`);
  }
}

/** Precalienta el modelo de decisión y el generativo, en ese orden (D0 es la primera consulta de cada tarea). Nunca lanza. */
export async function warmUpModels(getConfig: ConfigSource, fetchFn: FetchFn = fetch as unknown as FetchFn): Promise<void> {
  const config = getConfig();
  const decision = buildDecisionRequest(config, { state: "Request: hola", questions: { warmup: { type: "noul", instructions: "Is this a greeting?" } } });
  await ping(`decisión ${config.decisionModel}`, decision.url, decision.body, config.decisionTimeoutMs, fetchFn);

  const chat = JSON.stringify({
    model: config.qwenModel,
    messages: [{ role: "user", content: "hola" }],
    max_tokens: 1,
    stream: false,
    reasoning_effort: "none",
    keep_alive: config.modelKeepAlive,
  });
  await ping(`generativo ${config.qwenModel}`, chatUrl(config.qwenUrl), chat, config.qwenTimeoutMs, fetchFn);
}
