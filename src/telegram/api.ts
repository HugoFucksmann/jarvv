/** Cliente de la API HTTP de JARVIS (`/api/jarvis/*`, contrato en `docs/JARVIS_API.md`): la misma que usa la interfaz web. */

import type { TaskEvent } from "../core/tasks.ts";

export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

const RECONNECT_MS = 2000;

export class JarvisApi {
  constructor(private readonly base: string) {}

  /** POST con cuerpo JSON. Un error de red o un código no 2xx vuelve como `{ ok: false, error }` con un texto para el usuario. */
  async post<T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, error: "No se pudo contactar con JARVIS." };
    }
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) return { ok: false, error: json?.error ?? `Error ${res.status}` };
    return { ok: true, data: json as T };
  }

  /** GET; mismo formato de resultado que `post`. */
  async get<T = unknown>(path: string): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`);
    } catch {
      return { ok: false, error: "No se pudo contactar con JARVIS." };
    }
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) return { ok: false, error: json?.error ?? `Error ${res.status}` };
    return { ok: true, data: json as T };
  }

  /** Texto de la respuesta final de una tarea, o `null` si todavía no tiene. */
  async resultText(taskId: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.base}/state?taskId=${encodeURIComponent(taskId)}`);
      const snap = (await res.json()) as { task?: { result?: { text?: string } | null } | null };
      return snap.task?.result?.text ?? null;
    } catch {
      return null;
    }
  }

  /** Escucha los eventos (SSE) hasta que `signal` aborte; si la conexión se corta, reconecta. */
  async listen(onEvent: (event: TaskEvent) => void, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const res = await fetch(`${this.base}/events`, { signal });
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const raw = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = raw
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("");
            if (!data) continue; // comentario de keep-alive
            try {
              onEvent(JSON.parse(data) as TaskEvent);
            } catch {
              /* mensaje inválido */
            }
          }
        }
      } catch {
        if (signal.aborted) return;
      }
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const onAbort = (): void => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, RECONNECT_MS);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
}
