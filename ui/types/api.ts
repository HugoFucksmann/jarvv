/**
 * Contrato HTTP/SSE entre la UI y el backend JARVIS (/api/jarvis/*).
 * Todo se deriva del core (src/core): aquí solo se describe lo que viaja por el cable
 * y no es un modelo del core. No se redeclara nada que el core ya exporte.
 */

import type { CoreEvent, MCPTool, PendingApproval, Task } from "../../src/core/types.ts";

export type UnavailableServers = Record<string, { reason: string; since: number }>;

/**
 * Tarea tal como la envían `toWireTask` (SSE y `allTasks`): sin `modelIterations`.
 * `Task` y `WireTask` son asignables entre sí, porque en `Task` ese campo es opcional.
 */
export type WireTask = Omit<Task, "modelIterations">;

/** Espejo exacto de `serializePendingApproval` (jarvisRouter.ts): sin callbacks ni taskId. */
export type SerializedPendingApproval = Pick<
  PendingApproval,
  "id" | "stepId" | "mcp" | "tool" | "capability" | "args" | "reason"
>;

/** Error de cualquier endpoint: `{ error }` con status 4xx/5xx. */
export interface ApiErrorBody {
  error: string;
}

export interface OkResponse {
  ok: boolean;
}

/** POST /process */
export interface InitiateTaskResponse {
  task: Task;
}

/** GET /state. `task` es la tarea completa (con modelIterations); `allTasks`, la versión de cable. */
export interface StateResponse {
  task?: Task | null;
  pendingApproval: SerializedPendingApproval | null;
  allTasks: WireTask[];
  discoveredTools: Record<string, MCPTool[]>;
  unavailableServers: UnavailableServers;
}

/**
 * POST /refresh-discovery. En fallo el back responde 200 con `{ tools: {}, error }`:
 * quien consume debe revisar `error` además del status HTTP.
 */
export interface DiscoveryResponse {
  tools: Record<string, MCPTool[]>;
  unavailableServers?: UnavailableServers;
  error?: string;
}

/** Mensaje de GET /events (SSE). `task` se omite si el core no encuentra la tarea del evento. */
export interface SseMessage {
  event: CoreEvent;
  task?: WireTask | null;
  pendingApproval: SerializedPendingApproval | null;
}