/**
 * JARVIS Core — `ToolHost`: acceso de una herramienta compuesta a otras herramientas.
 *
 * Solo permite lo que el proveedor declaró en `dependencies`. Las llamadas pasan por `captureCallTool`, así que quedan en la traza de la tarea.
 * No vuelve a evaluar el Guard: la decisión se tomó sobre la llamada externa que el usuario ve y las sub-llamadas la heredan.
 */

import type { IDiscoveryEngine } from "../contracts.ts";
import { captureCallTool } from "../engine/capture.ts";
import type { CaptureSink } from "../trace/sink.ts";
import { toolKey } from "./manifest.ts";
import type { ToolHost, ToolRef } from "./provider.ts";

export function createToolHost(discovery: Pick<IDiscoveryEngine, "getServer">, allowed: readonly ToolRef[], sink: CaptureSink, taskId?: string): ToolHost {
  const permitted = new Set(allowed.map((ref) => toolKey(ref.server, ref.tool)));
  return {
    async call(ref, args, options) {
      if (!permitted.has(toolKey(ref.server, ref.tool))) throw new Error(`La herramienta '${ref.server}:${ref.tool}' no figura entre las dependencias declaradas.`);
      const server = discovery.getServer(ref.server);
      if (server === undefined) throw new Error(`Servidor '${ref.server}' no disponible.`);
      return captureCallTool(server, sink)(ref.tool, args, { signal: options?.signal, taskId });
    },
  };
}
