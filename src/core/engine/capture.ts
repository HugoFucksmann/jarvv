/**
 * JARVIS Core — Puntos de captura para la traza (Fase 5, D11).
 *
 * El motor no sabe de ids de llamada ni de la traza: solo ofrece un receptor opcional (`CaptureSink`, vacío por
 * defecto) y envoltorios que miden y reportan lo que cruza los bordes: las consultas a los modelos y `callTool`. Cada
 * evento lleva `n`, la versión del contexto al empezar la consulta; el registrador (Fase 7) lo enlaza con el `change`
 * correspondiente y con su paso. Los eventos no contienen ids. Un fallo del receptor nunca afecta al motor.
 *
 * Criterio: si se borra `trace/`, el motor compila y funciona igual (este archivo no importa nada de allí).
 */

import type { IMCPServer } from "../mcp/types.ts";
import type { ToolCallOptions } from "../tools/provider.ts";
import type { MCPCallResult, StageId } from "../types.ts";
import { errorMessage, isRecord } from "../utils.ts";
import type { EngineLLM, IActionDecision } from "../contracts.ts";
import type { CaptureSink } from "../trace/sink.ts";

export { NULL_SINK } from "../trace/sink.ts";
export type { CaptureSink, LlmCapture, ToolCapture } from "../trace/sink.ts";

function safely(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.error("[Capture] el receptor falló:", error);
  }
}

/** `rawInput` y `rawOutput` de un resultado o de un error de un modelo (`error.raw`), sin depender de su tipo exacto. */
function rawOf(source: unknown): { input: string | null; output: string | null } {
  if (!isRecord(source)) return { input: null, output: null };
  return {
    input: typeof source.rawInput === "string" ? source.rawInput : null,
    output: typeof source.rawOutput === "string" ? source.rawOutput : null,
  };
}

async function observe<T>(stage: StageId, sink: CaptureSink, version: () => number, call: () => Promise<T>): Promise<T> {
  const n = version();
  const startedAt = Date.now();
  try {
    const result = await call();
    const raw = rawOf(result);
    safely(() => sink.llm({ stage, n, startedAt, durationMs: Date.now() - startedAt, input: raw.input, output: raw.output, error: null }));
    return result;
  } catch (error) {
    const raw = rawOf(isRecord(error) ? error.raw : undefined);
    safely(() =>
      sink.llm({ stage, n, startedAt, durationMs: Date.now() - startedAt, input: raw.input, output: raw.output, error: errorMessage(error) }),
    );
    throw error;
  }
}

/** Envuelve el cliente del LLM: `generateArgumentsFromView` (`args`), `generateQuestion` (`question`), `generatePendingFromView` (`pending`), `generatePlanFromView` (`plan`) y `generateFinalFromView` (`final`). */
export function captureLlm(llm: EngineLLM, sink: CaptureSink, version: () => number): EngineLLM {
  return {
    generateArgumentsFromView: (input, signal) => observe("args", sink, version, () => llm.generateArgumentsFromView(input, signal)),
    generateQuestion: (input, signal) => observe("question", sink, version, () => llm.generateQuestion(input, signal)),
    generatePendingFromView: (input, signal) => observe("pending", sink, version, () => llm.generatePendingFromView(input, signal)),
    generatePlanFromView: (input, signal) => observe("plan", sink, version, () => llm.generatePlanFromView(input, signal)),
    generateFinalFromView: (input, signal) => observe("final", sink, version, () => llm.generateFinalFromView(input, signal)),
  };
}

/**
 * Envuelve Decision: `chooseRoute` (`route`), `chooseTool` (`tool`), `reviewArgs` (`review`), `verifyResult` (`verify`) y `checkCompletion` (`completion`).
 */
export function captureDecision(
  decision: IActionDecision,
  sink: CaptureSink,
  version: () => number,
): IActionDecision {
  return {
    chooseRoute: (input, signal) => observe("route", sink, version, () => decision.chooseRoute(input, signal)),
    chooseTool: (input, signal) => observe("tool", sink, version, () => decision.chooseTool(input, signal)),
    reviewArgs: (input, signal) => observe("review", sink, version, () => decision.reviewArgs(input, signal)),
    verifyResult: (input, signal) => observe("verify", sink, version, () => decision.verifyResult(input, signal)),
    checkCompletion: (input, signal) => observe("completion", sink, version, () => decision.checkCompletion(input, signal)),
  };
}

/**
 * Envuelve `callTool` de un servidor MCP. Devuelve la función que `runCall` usa para despachar. Si la llamada se
 * cancela en vuelo, el evento llega cuando la herramienta termina (el resultado tardío se descarta, pero se captura).
 */
export function captureCallTool(
  server: Pick<IMCPServer, "name" | "callTool">,
  sink: CaptureSink,
): (tool: string, args: Record<string, unknown>, options?: ToolCallOptions) => Promise<MCPCallResult> {
  return async (tool, args, options) => {
    const startedAt = Date.now();
    try {
      const result = await server.callTool(tool, args, options);
      safely(() => sink.tool({ mcp: server.name, tool, args, startedAt, durationMs: Date.now() - startedAt, result, error: null }));
      return result;
    } catch (error) {
      safely(() =>
        sink.tool({ mcp: server.name, tool, args, startedAt, durationMs: Date.now() - startedAt, result: null, error: errorMessage(error) }),
      );
      throw error;
    }
  };
}