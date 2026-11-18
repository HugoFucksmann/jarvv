/**
 * JARVIS Core — `ToolHost`: acceso de una herramienta compuesta a otras herramientas.
 *
 * Solo permite lo que el proveedor declaró en `dependencies`. Las llamadas pasan por el envoltorio de captura que recibe (`capture`, que arma el motor con
 * `captureCallTool`), así que quedan en la traza de la tarea; este módulo no conoce el motor ni la traza.
 * No vuelve a evaluar el Guard: la decisión se tomó sobre la llamada externa que el usuario ve y las sub-llamadas la heredan.
 */

import type { IDiscoveryEngine } from "../contracts.ts";
import type { IMCPServer } from "../mcp/types.ts";
import type { MCPCallResult } from "../types.ts";
import { toolKey } from "./manifest.ts";
import type { ToolCallOptions, ToolHost, ToolRef } from "./provider.ts";

/** Cómo se despacha una llamada a un servidor (con la captura de la traza ya aplicada, si corresponde). */
export type CaptureCall = (server: IMCPServer) => (tool: string, args: Record<string, unknown>, options?: ToolCallOptions) => Promise<MCPCallResult>;

export function createToolHost(discovery: Pick<IDiscoveryEngine, "getServer">, allowed: readonly ToolRef[], capture: CaptureCall, taskId?: string): ToolHost {
  const permitted = new Set(allowed.map((ref) => toolKey(ref.server, ref.tool)));
  return {
    async call(ref, args, options) {
      if (!permitted.has(toolKey(ref.server, ref.tool))) throw new Error(`La herramienta '${ref.server}:${ref.tool}' no figura entre las dependencias declaradas.`);
      const server = discovery.getServer(ref.server);
      if (server === undefined) throw new Error(`Servidor '${ref.server}' no disponible.`);
      return capture(server)(ref.tool, args, { signal: options?.signal, taskId });
    },
  };
}

/** Despacho directo, sin captura de la traza: para quien no corre dentro de una tarea (los scripts de validación). */
export const DIRECT_CALL: CaptureCall = (server) => (tool, args, options) => server.callTool(tool, args, options);
