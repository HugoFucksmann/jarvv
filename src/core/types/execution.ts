import type { ExecutableRoute } from "./routes.ts";

/** Acción ya ejecutada, tal como la ven Decision #1 y #2 para marcar rutas y herramientas cuyo último intento falló. */
export interface Attempt {
  /** Destino bajo el que se ejecutó la herramienta: es el vocabulario de Decision #1. */
  route: ExecutableRoute;
  /** Servidor MCP real: acota el estado "falló" de Decision #2. */
  mcp?: string;
  tool: string;
  ok: boolean;
  note?: string;
}
