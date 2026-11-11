/**
 * JARVIS Core — Contrato de los extractores de resultados (Fase 4)
 *
 * Un extractor convierte el texto de una herramienta en lo que Jarvis conserva de ella: un `summary` (el resultado
 * recortado, sin modelos y sin claves de ref: PLAN_CONTEXT 5.2), si omitió contenido (`truncated`) y las señales que
 * el procesador necesita para clasificar la llamada. Es determinista y no sanea el texto (C9: lo hacen las vistas).
 * Ya no produce hallazgos, hechos ni scratchpad: lo que se infiere de `args` se deriva, y los hechos los escribe el
 * ejecutor. El orquestador (`processResult`) hace lo común: leer el MCP y clasificar.
 */

import type { NativeResult } from "../../tools/result.ts";

export interface ExtractorInput {
    mcp: string;
    tool: string;
    args: Record<string, unknown>;
    isError: boolean;
    success: boolean;
    /** Texto de todos los bloques `text`, unido con `\n` y sin espacios en los extremos: el resultado crudo. */
    fullText: string;
    /** Resultado del MCP más el JSON embebido en su texto (si lo hay). */
    mergedData: Record<string, any>;
    /** Solo si el resultado es de un proveedor nativo (`tools/result.ts`): `text`, `raw`, `data` y `meta` ya separados. */
    native?: NativeResult;
}

/** Señales que un extractor aporta al procesador (el resto se deriva del resultado MCP). */
export interface ExtractorSignals {
    /** Código de salida leído del texto de un proceso. */
    exit_code?: number;
    /** El resultado existe pero no tiene datos (archivo vacío, búsqueda sin resultados). */
    empty_output?: boolean;
    /** El proceso sigue vivo y pide una respuesta del usuario; `prompt` es lo que pide. */
    waiting_input?: { prompt: string };
}

/** Proceso en segundo plano: el ejecutor lo convierte en el hecho `process` (Fase 5). */
export interface ProcessSignal {
    /** Id del proceso, como texto. */
    pid: string;
    /** `true` si el proceso sigue en ejecución; `false` si terminó. */
    active: boolean;
}

export interface ExtractorOutput {
    /** `null` cuando el `status` basta (no hay texto que mostrar). Nunca `""`. */
    summary: string | null;
    /** `true` si el extractor omitió texto de contenido; un recorte de metadatos no cuenta. */
    truncated: boolean;
    signals?: ExtractorSignals;
    /** Solo las herramientas de procesos, y solo si el pid se conoce. */
    process?: ProcessSignal;
}

export type Extractor = (input: ExtractorInput) => ExtractorOutput;
