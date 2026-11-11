/**
 * JARVIS Core — Contrato de resultados de los proveedores nativos.
 *
 * Un resultado nativo es un `MCPCallResult` con `structuredContent` y `_meta` (campos del protocolo MCP: el formato es el mismo que iría por el cable):
 * - `content[0].text`: lo que ve el modelo (`text`).
 * - `structuredContent.raw`: el resultado completo, para la ref en disco. Si es igual a `text`, no hay ref.
 * - `structuredContent.data`: estado y señales que el núcleo lee (`state`, `pid`, `exitCode`, `prompt`); la forma de cada campo la documenta su proveedor.
 * - `_meta`: diagnóstico para la traza (nunca va a los modelos).
 * `structuredContent.schema` y `_meta.schema` llevan la versión del esquema; un resultado sin ella no es nativo y lo trata el extractor de la herramienta.
 */

import type { MCPCallResult } from "../types.ts";
import { isRecord } from "../utils.ts";

export const TOOL_RESULT_SCHEMA = 1;

/** Estados de `data.state` que el núcleo interpreta (el resto del `data` es libre). */
export const RESULT_STATES = ["finished", "running", "waiting_input", "cancelled", "found", "partial", "not_found", "no_results"] as const;
export type ResultState = (typeof RESULT_STATES)[number];

export interface ToolResultParts {
  readonly text: string;
  readonly raw: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
  /** La herramienta no pudo hacer lo pedido (argumentos inválidos, fallo propio). Un proceso que terminó con código distinto de 0 NO es un error de la herramienta. */
  readonly isError?: boolean;
}

export interface NativeResult {
  readonly text: string;
  readonly raw: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, unknown>>;
}

/** Arma el resultado de una herramienta nativa. */
export function toolResult(parts: ToolResultParts): MCPCallResult {
  const isError = parts.isError === true;
  return {
    content: [{ type: "text", text: parts.text }],
    isError,
    success: !isError,
    structuredContent: { schema: TOOL_RESULT_SCHEMA, raw: parts.raw, data: { ...parts.data } },
    _meta: { schema: TOOL_RESULT_SCHEMA, ...(parts.meta ?? {}) },
  };
}

/** El resultado nativo que lleva `result`, o `null` si no es uno (o su esquema no es el vigente). */
export function readToolResult(result: MCPCallResult): NativeResult | null {
  const structured = result.structuredContent;
  if (!isRecord(structured) || structured.schema !== TOOL_RESULT_SCHEMA || typeof structured.raw !== "string") return null;
  const text = result.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim();
  const meta = isRecord(result._meta) ? result._meta : {};
  return { text, raw: structured.raw, data: isRecord(structured.data) ? structured.data : {}, meta };
}
