/**
 * JARVIS Core — Receptor de la captura para la traza: los tipos de los eventos y el receptor vacío.
 *
 * Vive aparte de `capture.ts` (los envoltorios) para que `deps.ts` pueda declarar `EngineServices.sink` sin importar un archivo que a su
 * vez importa de `deps.ts`.
 */

import type { MCPCallResult, StageId } from "../types.ts";

/** Consulta a un modelo que se captura; `stage` es uno de `STAGES`. */
export interface LlmCapture {
  readonly stage: StageId;
  /** Versión del contexto (`ctx.n`) cuando empezó la consulta. */
  readonly n: number;
  readonly startedAt: number;
  readonly durationMs: number;
  /** Entrada cruda enviada al modelo, si se conoce. */
  readonly input: string | null;
  /** Salida cruda del modelo, si se conoce (también en una salida inválida). */
  readonly output: string | null;
  /** Mensaje del error si la consulta falló. */
  readonly error: string | null;
}

export interface ToolCapture {
  readonly mcp: string;
  readonly tool: string;
  /** Argumentos resueltos tal como se despacharon. */
  readonly args: Record<string, unknown>;
  readonly startedAt: number;
  readonly durationMs: number;
  /** Resultado crudo; `null` si la herramienta lanzó. */
  readonly result: MCPCallResult | null;
  readonly error: string | null;
}

export interface CaptureSink {
  llm(event: LlmCapture): void;
  tool(event: ToolCapture): void;
}

/** Receptor vacío: la versión por defecto cuando no hay traza. */
export const NULL_SINK: CaptureSink = Object.freeze({
  llm: () => undefined,
  tool: () => undefined,
});
