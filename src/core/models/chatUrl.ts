/**
 * JARVIS Core — URL del endpoint de chat OpenAI-compatible del modelo generativo.
 *
 * Única fuente de la regla (la usan `QwenEngine`, el precalentamiento y el cliente del eval): se acepta la base del servidor, la base con `/v1`
 * o la URL completa `/v1/chat/completions`; los endpoints viejos `/generate` y `/api/chat` ya no se admiten. Cada capa traduce el resultado a
 * su propio error y mensaje.
 */

type ChatUrlResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: "empty" | "unsupported"; readonly base: string };

export function chatCompletionsUrl(raw: string): ChatUrlResult {
  const base = raw.trim().replace(/\/+$/, "");
  if (!base) return { ok: false, reason: "empty", base };
  if (base.endsWith("/v1/chat/completions")) return { ok: true, url: base };
  if (/\/(generate|api\/chat)$/.test(base)) return { ok: false, reason: "unsupported", base };
  return { ok: true, url: base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions` };
}
