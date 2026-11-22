/**
 * JARVIS Core — Errores con los que un modelo (generativo o de decisión) avisa al motor que no pudo responder o que su respuesta no sirve.
 *
 * Son parte del contrato entre el motor y los modelos: los lanzan `models/qwen.ts` y `models/decision.ts` y los clasifica `engine/failures.ts`. Viven acá, y no en el
 * transporte de los modelos, para que el motor no tenga que importar `core/models`.
 */

import type { FailedAttempt, TimeSpan } from "../types.ts";

/** El LLM no responde: red, HTTP no-OK, timeout o configuración ausente. */
export class LLMServiceUnavailableError extends Error {
    readonly raw?: { rawInput: string; timing?: TimeSpan };
    readonly retryable: boolean;
    constructor(message: string, cause?: unknown, raw?: { rawInput: string; timing?: TimeSpan }, retryable = true) {
        super(`[LLM Unavailable] ${message}`, { cause });
        this.name = "LLMServiceUnavailableError";
        this.raw = raw;
        this.retryable = retryable;
    }
}

/**
 * El LLM respondió, pero la salida no es utilizable tras el reintento (o el prompt no cabe en el contexto).
 * `overflow` distingue el segundo caso: el prompt no se envió y repetirlo no sirve (D15).
 */
export class LLMValidationError extends Error {
    readonly raw?: { rawInput: string; rawOutput: string; timing?: TimeSpan };
    readonly attempts?: FailedAttempt[];
    readonly overflow: boolean;
    constructor(
        message: string,
        raw?: { rawInput: string; rawOutput: string; timing?: TimeSpan },
        attempts?: FailedAttempt[],
        overflow = false
    ) {
        super(`[LLM Validation] ${message}`);
        this.name = "LLMValidationError";
        this.raw = raw;
        this.attempts = attempts;
        this.overflow = overflow;
    }
}

export class DecisionServiceUnavailableError extends Error {
    readonly retryable: boolean;
    constructor(message: string, cause?: unknown, retryable = true) {
        super(`[Decision 2.0 Unavailable] ${message}`, { cause });
        this.name = "DecisionServiceUnavailableError";
        this.retryable = retryable;
    }
}

/**
 * Decision respondió algo inválido, o el payload no cabe en su contexto. `overflow` distingue el segundo caso: no se
 * envió nada y repetir no sirve (D15).
 */
export class DecisionValidationError extends Error {
    readonly overflow: boolean;
    readonly raw?: { rawInput: string; rawOutput: string; timing?: TimeSpan };
    constructor(message: string, overflow = false, raw?: { rawInput: string; rawOutput: string; timing?: TimeSpan }) {
        super(`[Decision 2.0 Validation] ${message}`);
        this.name = "DecisionValidationError";
        this.overflow = overflow;
        this.raw = raw;
    }
}
