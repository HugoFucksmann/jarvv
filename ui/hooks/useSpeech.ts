import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechStatus = "idle" | "loading" | "playing";

const SAMPLE_RATE = 24000;

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** `onError`: aviso al usuario cuando la voz falla (servidor de voz caído, voz desactivada…). */
export function useSpeech(onError?: (message: string) => void) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const streamDoneRef = useRef(true);
  const ctxRef = useRef<AudioContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    for (const s of sourcesRef.current) {
      try {
        s.stop();
      } catch {
        /* ya detenido */
      }
    }
    sourcesRef.current = [];
    streamDoneRef.current = true;
    setStatus("idle");
  }, []);

  const speak = useCallback(
    async (text: string) => {
      stop();
      streamDoneRef.current = false;
      setStatus("loading");
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const ctx = (ctxRef.current ??= new AudioContext({ sampleRate: SAMPLE_RATE }));
        await ctx.resume();
        const res = await fetch("/api/jarvis/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          let reason = `Error ${res.status}`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body?.error) reason = body.error;
          } catch {
            /* sin cuerpo JSON */
          }
          if (abortRef.current === ac) {
            abortRef.current = null;
            streamDoneRef.current = true;
            setStatus("idle");
            onError?.(`Voz: ${reason}`);
          }
          return;
        }

        const reader = res.body.getReader();
        let leftover: Uint8Array = new Uint8Array(0);
        let t = ctx.currentTime + 0.05;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const bytes = concat(leftover, value);
          const usable = bytes.length - (bytes.length % 2);
          leftover = bytes.slice(usable);
          if (usable === 0) continue;

          const i16 = new Int16Array(bytes.slice(0, usable).buffer);
          const f32 = Float32Array.from(i16, (v) => v / 32768);
          const buf = ctx.createBuffer(1, f32.length, SAMPLE_RATE);
          buf.copyToChannel(f32, 0);

          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.onended = () => {
            sourcesRef.current = sourcesRef.current.filter((x) => x !== src);
            if (sourcesRef.current.length === 0 && streamDoneRef.current) setStatus("idle");
          };
          t = Math.max(t, ctx.currentTime);
          src.start(t);
          t += buf.duration;
          sourcesRef.current.push(src);
          setStatus("playing");
        }
        streamDoneRef.current = true;
        if (sourcesRef.current.length === 0 && abortRef.current === ac) setStatus("idle");
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          console.error("TTS:", e);
          if (abortRef.current === ac) {
            streamDoneRef.current = true;
            setStatus("idle");
            onError?.("Voz: no se pudo reproducir el audio.");
          }
        }
      }
    },
    [stop, onError]
  );

  return { speak, stop, status };
}

/**
 * Con la interfaz abierta en varias pestañas, todas reciben el mismo evento y todas leerían la respuesta (voces solapadas).
 * Cada pestaña anota su marca en `localStorage` y, pasado un instante, habla solo la que quedó escrita (la última en escribir).
 */
async function claimSpeech(taskId: string): Promise<boolean> {
  try {
    const mark = `${taskId}:${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("jarvis:speech-claim", mark);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return localStorage.getItem("jarvis:speech-claim") === mark;
  } catch {
    return true; // sin almacenamiento no hay forma de coordinar: se habla
  }
}

/**
 * Lee en voz alta la respuesta final que aparece en vivo en la tarea que se está viendo. No lee las de tareas ya terminadas que se
 * abren del historial, y corta la lectura al cambiar de tarea o al cerrar la interfaz.
 */
export function useSpeakNewResults(
  taskId: string | null,
  resultText: string | null,
  enabled: boolean,
  speak: (text: string) => Promise<void>,
  stop: () => void
): void {
  // Última tarea vista y si ya tenía resultado al verla.
  const seen = useRef<{ id: string | null; hadResult: boolean }>({ id: null, hadResult: true });

  useEffect(() => {
    const prev = seen.current;
    if (taskId !== prev.id) {
      seen.current = { id: taskId, hadResult: resultText !== null };
      stop();
      return;
    }
    if (resultText === null || prev.hadResult) return;
    seen.current = { id: taskId, hadResult: true };
    if (enabled && taskId !== null) {
      void claimSpeech(taskId).then((mine) => {
        if (mine) void speak(resultText);
      });
    }
  }, [taskId, resultText, enabled, speak, stop]);

  useEffect(() => () => stop(), [stop]);
}
