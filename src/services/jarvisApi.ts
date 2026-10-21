/**
 * Client API Service for JARVIS Backend
 * Centralizes all HTTP communications with /api/jarvis/*
 */

import { getApiUrl } from "../utils/apiUrl.ts";
import type { Task, MCPTool, PendingApproval } from "../core/types.ts";
import type { JarvisConfig } from "../core/config.ts";

type UnavailableServers = Record<string, { reason: string; since: number }>;

export interface OkResponse {
  ok: boolean;
}

export interface SerializedPendingApproval {
  id: string;
  taskId?: string;
  stepId: string;
  mcp: string;
  tool: string;
  capability: PendingApproval["capability"];
  args: Record<string, unknown>;
  reason: string;
}

export interface StateResponse {
  task: Task | null;
  pendingApproval: SerializedPendingApproval | null;
  allTasks: Task[];
  discoveredTools: Record<string, MCPTool[]>;
  unavailableServers: UnavailableServers;
}

export interface DiscoveryResponse {
  tools: Record<string, MCPTool[]>;
  unavailableServers?: UnavailableServers;
  error?: string;
}

async function handleResponse<T>(res: Response, defaultErrorMsg: string): Promise<T> {
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `${defaultErrorMsg} (HTTP ${res.status})`);
  }
  return res.json();
}

async function request<T>(path: string, errorMsg: string, init?: RequestInit): Promise<T> {
  const res = await fetch(getApiUrl(path), init);
  return handleResponse<T>(res, errorMsg);
}

function post<T>(path: string, body: object, errorMsg: string): Promise<T> {
  return request<T>(path, errorMsg, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Cuerpo de las acciones sobre una tarea. Los valores vacíos se omiten para que el backend
 * aplique su propio valor por defecto (p. ej. cancelar la tarea en ejecución si no hay taskId).
 */
function taskBody(taskId?: string, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const body: Record<string, string> = {};
  if (taskId) body.taskId = taskId;
  for (const [key, value] of Object.entries(extra)) {
    if (value) body[key] = value;
  }
  return body;
}

export const jarvisApi = {
  /** Obtiene el snapshot de estado del backend. */
  getState(taskId?: string): Promise<StateResponse> {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
    return request<StateResponse>(`/api/jarvis/state${query}`, "Error al obtener el estado");
  },

  /** Inicia una nueva tarea en el backend. */
  initiateTask(message: string, mode: "NORMAL" | "PLAN"): Promise<{ task: Task }> {
    return post("/api/jarvis/process", { message: message.trim(), mode }, "Error al iniciar la tarea");
  },

  /** Cancela una tarea activa. Sin taskId, el backend cancela la tarea en ejecución. */
  cancelTask(taskId?: string): Promise<OkResponse> {
    return post("/api/jarvis/cancel", taskBody(taskId), "Error al cancelar la tarea");
  },

  /** Confirma la ejecución de un plan en modo PLAN. */
  confirmPlan(taskId?: string): Promise<OkResponse> {
    return post("/api/jarvis/confirm-plan", taskBody(taskId), "Error al confirmar el plan");
  },

  /** Rechaza el plan propuesto con motivo opcional. */
  rejectPlan(taskId?: string, reason?: string): Promise<OkResponse> {
    return post("/api/jarvis/reject-plan", taskBody(taskId, { reason }), "Error al rechazar el plan");
  },

  /** Solicita modificación de un plan en modo PLAN enviando feedback correctivo. */
  modifyPlan(taskId?: string, feedback?: string): Promise<OkResponse> {
    return post(
      "/api/jarvis/modify-plan",
      taskBody(taskId, { feedback }),
      "Error al solicitar modificación del plan"
    );
  },

  /** Envía la respuesta del usuario a una pregunta interactiva (WAITING_INPUT / user_answer). */
  provideUserAnswer(taskId?: string, answer: string = ""): Promise<OkResponse> {
    return post(
      "/api/jarvis/user-answer",
      { answer, ...taskBody(taskId) },
      "Error al enviar respuesta interactiva"
    );
  },

  /** Aprueba una operación pendiente bloqueada por Guard. */
  approvePending(taskId?: string): Promise<OkResponse> {
    return post("/api/jarvis/approve", taskBody(taskId), "Error al aprobar la operación");
  },

  /** Deniega una operación pendiente de Guard con motivo opcional. */
  denyPending(taskId?: string, reason?: string): Promise<OkResponse> {
    return post("/api/jarvis/deny", taskBody(taskId, { reason }), "Error al denegar la operación");
  },

  /** Refresca el catálogo de Discovery forzando relectura de servidores stdio. */
  refreshDiscovery(): Promise<DiscoveryResponse> {
    return request<DiscoveryResponse>(
      "/api/jarvis/refresh-discovery",
      "Error al refrescar el catálogo de herramientas",
      { method: "POST" }
    );
  },

  /** Obtiene la configuración actual de servicios externos. */
  getConfig(): Promise<JarvisConfig> {
    return request<JarvisConfig>("/api/jarvis/config", "Error al obtener la configuración");
  },

  /** Actualiza la configuración en el backend. */
  updateConfig(config: Partial<JarvisConfig>): Promise<JarvisConfig> {
    return post<JarvisConfig>("/api/jarvis/config", config, "Error al guardar la configuración");
  },
};