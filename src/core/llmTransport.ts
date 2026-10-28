/**
 * JARVIS Core — Transporte HTTP compartido por Qwen y Decision 2.0
 *
 * Política única:
 * - Fallo de red o HTTP 503: 1 reintento tras 1 s (LLM_TRANSPORT_*).
 * - Timeout o cancelación: NUNCA se reintentan.
 * - El timeout es un presupuesto total de la llamada (incluye el reintento).
 */

import { LLM_TRANSPORT_BACKOFF_MS, LLM_TRANSPORT_RETRIES } from "./types.ts";

/** El usuario canceló (AbortSignal propio). Se propaga sin ser reclasificada. */
export class RequestAbortedError extends Error {
    constructor(message = "Operación cancelada por el usuario.") {
        super(message);
        this.name = "RequestAbortedError";
    }
}

/** Timeout o fallo de red persistente. Cada motor lo traduce a su error "Unavailable". */
export class TransportError extends Error {
    readonly kind: "timeout" | "network";
    constructor(kind: "timeout" | "network", message: string, cause?: unknown) {
        super(message, { cause });
        this.name = "TransportError";
        this.kind = kind;
    }
}

/** Estimación conservadora (3 caracteres por token) para guardas de contexto. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

export interface PostJsonOptions {
    url: string;
    /** Cuerpo ya serializado. */
    body: string;
    timeoutMs: number;
    signal?: AbortSignal;
}

export interface PostJsonResult {
    ok: boolean;
    status: number;
    statusText: string;
    text: string;
}

const REQUEST_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
};

function describe(err: unknown): string {
    if (!(err instanceof Error)) return String(err);
    const cause = err.cause instanceof Error ? ` (${err.cause.message})` : "";
    return `${err.message}${cause}`;
}

export async function postJson(o: PostJsonOptions): Promise<PostJsonResult> {
    const timeout = AbortSignal.timeout(o.timeoutMs);
    const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;

    /** Cancelación o timeout => error terminal; cualquier otra cosa => null (reintentable). */
    const interrupted = (err: unknown): Error | null => {
        if (o.signal?.aborted) return new RequestAbortedError();
        if (timeout.aborted) return new TransportError("timeout", `sin respuesta tras ${o.timeoutMs}ms`, err);
        return null;
    };

    for (let attempt = 0; ; attempt++) {
        let reason: string;
        try {
            const response = await fetch(o.url, { method: "POST", headers: REQUEST_HEADERS, body: o.body, signal });
            const text = await response.text();
            if (response.status !== 503 || attempt >= LLM_TRANSPORT_RETRIES) {
                return { ok: response.ok, status: response.status, statusText: response.statusText, text };
            }
            reason = "HTTP 503";
        } catch (err) {
            const stop = interrupted(err);
            if (stop) throw stop;
            if (attempt >= LLM_TRANSPORT_RETRIES) throw new TransportError("network", describe(err), err);
            reason = `error de red: ${describe(err)}`;
        }

        console.warn(`[Transport] ${reason}; reintento ${attempt + 1}/${LLM_TRANSPORT_RETRIES} en ${LLM_TRANSPORT_BACKOFF_MS}ms (${o.url})`);
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, LLM_TRANSPORT_BACKOFF_MS);
            signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
        }).catch((err) => { throw interrupted(err) ?? err; });
    }
}