/**
 * JARVIS Core — Contrato de los proveedores de herramientas.
 *
 * Un proveedor es lo que el núcleo consume para ejecutar herramientas: un servidor MCP por stdio (adaptadores en `mcp/`) o un módulo nativo en
 * proceso (`src/tools/<nombre>/`, fuera de `core/`). El núcleo solo conoce esta interfaz y el contrato de resultados (`result.ts`); nunca un
 * proveedor concreto. Los nativos se registran al arrancar, en `server.ts`, igual que los adaptadores.
 */

import type { MCPCallResult, MCPTool } from "../types.ts";

/** Cómo terminó una tarea, para el gancho de cierre por tarea (`ToolProvider.onTaskEnd`). */
export type TaskEndOutcome = "completed" | "failed" | "cancelled";

/** Referencia a una herramienta de otro proveedor (las dependencias que declara una herramienta compuesta). */
export interface ToolRef {
  readonly server: string;
  readonly tool: string;
}

/**
 * Acceso mínimo a otras herramientas para una herramienta compuesta. Solo deja pasar las que el proveedor declara en `dependencies`; la decisión
 * del Guard se tomó sobre la llamada externa y las sub-llamadas la heredan. Cada sub-llamada queda en la traza.
 */
export interface ToolHost {
  call(ref: ToolRef, args: Record<string, unknown>, options?: { readonly signal?: AbortSignal }): Promise<MCPCallResult>;
}

/** Lo que el motor pasa en cada llamada. Un adaptador MCP lo ignora; un proveedor nativo lo usa. */
export interface ToolCallOptions {
  /** Se aborta si la tarea se cancela: el proveedor debe dejar de trabajar y liberar lo que lanzó. */
  readonly signal?: AbortSignal;
  /** Plazo de la herramienta (del manifiesto), en milisegundos. Es el techo de cuánto puede esperar la llamada. */
  readonly timeoutMs?: number;
  /** Tarea que hace la llamada: los proveedores que lanzan procesos lo usan para cerrarlos al terminar la tarea. */
  readonly taskId?: string;
  /** Solo si el proveedor declara `dependencies`. */
  readonly host?: ToolHost;
}

export interface ToolProvider {
  readonly name: string;
  readonly version: string;
  /** Herramientas de otros proveedores que usa por dentro (vía `ToolCallOptions.host`). */
  readonly dependencies?: readonly ToolRef[];
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, args: Record<string, unknown>, options?: ToolCallOptions): Promise<MCPCallResult>;
  isConnected(): boolean;
  reconnect(): Promise<void>;
  close?(): Promise<void>;
  /**
   * El motor lo invoca al terminar cada tarea. Con `failed` o `cancelled`, el proveedor cierra lo que la tarea dejó corriendo; con `completed`
   * lo conserva (pudo ser justo lo pedido). Nunca lanza: un fallo se informa por consola.
   */
  onTaskEnd?(taskId: string, outcome: TaskEndOutcome): Promise<void>;
}
