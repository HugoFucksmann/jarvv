/** Servidor TTS compatible con OpenAI (`scripts/phonon_server.py`). Quien no quiere voz no construye una: la ausencia es "voz apagada". */
export interface VoiceConfig {
  /** Voz del servidor ("default" usa la predeterminada; `GET /v1/audio/voices` lista las disponibles). */
  voice: string;
  /** URL base, p. ej. "http://127.0.0.1:8880". */
  baseUrl: string;
}

const MAX_CHARS = 4000; // el servidor Phonon admite hasta 4096 por request

export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_~>|]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?…])\s+|\n+/).filter(Boolean);

export function splitForSpeech(text: string, max = MAX_CHARS): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentencesOf(text)) {
    if (cur && cur.length + 1 + s.length > max) {
      chunks.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.flatMap((c) =>
    c.length <= max ? [c] : (c.match(new RegExp(`.{1,${max}}`, "gs")) ?? [])
  );
}

/** El comienzo de `text` listo para leerse, de a lo sumo `max` caracteres y cortado en una frase entera (una respuesta larga no se lee entera). */
export function speechExcerpt(text: string, max: number): string {
  let spoken = "";
  for (const sentence of sentencesOf(cleanForSpeech(text))) {
    if (spoken && spoken.length + sentence.length > max) break;
    spoken = spoken ? `${spoken} ${sentence}` : sentence;
  }
  return spoken;
}

/** Streams PCM 16-bit LE, mono, 24 kHz (los chunks se pueden concatenar). */
export async function* streamSpeech(
  text: string,
  cfg: VoiceConfig,
  signal?: AbortSignal
): AsyncGenerator<Uint8Array> {
  for (const input of splitForSpeech(cleanForSpeech(text))) {
    const res = await fetch(`${cfg.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tts-1", // el servidor lo ignora; se envía por compatibilidad con OpenAI
        voice: cfg.voice,
        input,
        response_format: "pcm",
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`TTS ${res.status}: ${await res.text()}`);
    }
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      yield chunk;
    }
  }
}
