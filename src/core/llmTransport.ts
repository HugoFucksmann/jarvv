/**
 * JARVIS Core — Transporte HTTP compartido por Qwen y Decision 2.0, y los errores de ambos motores
 * (viven aquí para que quien los captura no dependa de las implementaciones).
 *
 * Política única:
 * - Fallo de red o HTTP 503: 1 reintento tras 1 s (LLM_TRANSPORT_*).
 * - Timeout o cancelación: NUNCA se reintentan.
 * - El timeout es un presupuesto total de la llamada (incluye el reintento).
 */

import { LLM_TRANSPORT_BACKOFF_MS, LLM_TRANSPORT_RETRIES, type FailedAttempt, type TimeSpan } from "./types.ts";

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

/** Qwen no responde: red, HTTP no-OK, timeout o configuración ausente. */
export class LLMServiceUnavailableError extends Error {
    readonly raw?: { rawInput: string; timing?: TimeSpan };
    constructor(message: string, cause?: unknown, raw?: { rawInput: string; timing?: TimeSpan }) {
        super(`[Qwen Unavailable] ${message}`, { cause });
        this.name = "LLMServiceUnavailableError";
        this.raw = raw;
    }
}

/** Qwen respondió, pero la salida no es utilizable tras el reintento (o el prompt no cabe en el contexto). */
export class LLMValidationError extends Error {
    readonly raw?: { rawInput: string; rawOutput: string; timing?: TimeSpan };
    readonly attempts?: FailedAttempt[];
    constructor(message: string, raw?: { rawInput: string; rawOutput: string; timing?: TimeSpan }, attempts?: FailedAttempt[]) {
        super(`[Qwen Validation] ${message}`);
        this.name = "LLMValidationError";
        this.raw = raw;
        this.attempts = attempts;
    }
}

export class DecisionServiceUnavailableError extends Error {
    constructor(message: string, cause?: unknown) {
        super(`[Decision 2.0 Unavailable] ${message}`, { cause });
        this.name = "DecisionServiceUnavailableError";
    }
}

export class DecisionValidationError extends Error {
    constructor(message: string) {
        super(`[Decision 2.0 Validation] ${message}`);
        this.name = "DecisionValidationError";
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
    /** Headers adicionales que se fusionan sobre los base (Content-Type, Accept). */
    headers?: Record<string, string>;
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
            const response = await fetch(o.url, { method: "POST", headers: { ...REQUEST_HEADERS, ...o.headers }, body: o.body, signal });
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