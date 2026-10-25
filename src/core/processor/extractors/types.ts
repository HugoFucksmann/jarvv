/**
 * JARVIS Core — Contrato de los extractores de resultados
 *
 * Un extractor convierte el texto de una herramienta en lo que Jarvis conserva de ella: hallazgo (una línea para
 * LOG/FAIL/efectos), observación compacta (lo que ve el modelo), hechos, scratchpad y señales. Es determinista: sin
 * prosa de modelos. El orquestador (ResultProcessor) hace lo común: leer el MCP, guardar la referencia y clasificar.
 */

import type { Scratchpad, StepExecutionSignals } from "../../types.ts";

export interface ExtractorInput {
    mcp: string;
    tool: string;
    args: Record<string, unknown>;
    isError: boolean;
    success: boolean;
    /** Texto de todos los bloques de contenido, unido y recortado. */
    fullText: string;
    /** Resultado del MCP más el JSON embebido en su texto (si lo hay). */
    mergedData: Record<string, any>;
    /** Clave de RefStore del texto completo; undefined si no hubo texto. */
    refKey: string | undefined;
}

export interface ExtractorOutput {
    finding: string;
    compactObs: string;
    factsDelta?: Record<string, string>;
    scratchpadDelta?: Partial<Scratchpad>;
    signals?: Partial<StepExecutionSignals>;
}

export type Extractor = (input: ExtractorInput) => ExtractorOutput;