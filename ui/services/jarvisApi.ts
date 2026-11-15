/**
 * Client API Service for JARVIS Backend
 * Centralizes all HTTP communications with /api/jarvis/*
 * Los tipos del cable viven en ../types/api.ts.
 */

import { getApiUrl } from "../utils/apiUrl.ts";
import type {
  BlacklistEntry,
  ConfigPatch,
  DiscoveryResponse,
  EngineLimits,
  ExecutionMode,
  InitiateTaskResponse,
  JarvisConfig,
  OkResponse,
  StateResponse,
  UserEnvironment,
} from "../types/api.ts";

export type {
  BlacklistEntry,
  ConfigPatch,
  DiscoveryResponse,
  EngineLimits,
  InitiateTaskResponse,
  JarvisConfig,
  OkResponse,
  StateResponse,
  TaskDto,
  TaskSummary,
  UnavailableServers,
  UserEnvironment,
  Waiting,
  WaitingApproval,
  WaitingPlan,
  WaitingQuestion,
} from "../types/api.ts";

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

async function requestText(path: string, errorMsg: string, init?: RequestInit): Promise<string> {
  const res = await fetch(getApiUrl(path), init);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `${errorMsg} (HTTP ${res.status})`);
  }
  return res.text();
}

function post<T>(path: string, body: object, errorMsg: string): Promise<T> {
  return request<T>(path, errorMsg, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function taskBody(
  taskId?: string,
  waitId?: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (taskId) body.taskId = taskId;
  if (waitId) body.waitId = waitId;
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") body[key] = value;
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
  initiateTask(message: string, mode?: ExecutionMode): Promise<InitiateTaskResponse> {
    const body: { message: string; mode?: ExecutionMode } = { message: message.trim() };
    if (mode) body.mode = mode;
    return post("/api/jarvis/process", body, "Error al iniciar la tarea");
  },

  /** Cancela una tarea activa. Sin taskId, el backend cancela la última tarea abierta. */
  cancelTask(taskId?: string): Promise<OkResponse> {
    return post("/api/jarvis/cancel", taskBody(taskId), "Error al cancelar la tarea");
  },

  /** Confirma la ejecución del plan propuesto en modo deliberativo. */
  confirmPlan(taskId?: string, waitId?: string): Promise<OkResponse> {
    return post("/api/jarvis/confirm-plan", taskBody(taskId, waitId), "Error al confirmar el plan");
  },

  /** Rechaza el plan propuesto (la tarea se cancela). */
  rejectPlan(taskId?: string, waitId?: string): Promise<OkResponse> {
    return post("/api/jarvis/reject-plan", taskBody(taskId, waitId), "Error al rechazar el plan");
  },

  /** Solicita modificación de un plan enviando instrucción correctiva (feedback). */
  modifyPlan(feedback: string, taskId?: string, waitId?: string): Promise<OkResponse> {
    return post(
      "/api/jarvis/modify-plan",
      taskBody(taskId, waitId, { feedback }),
      "Error al solicitar modificación del plan"
    );
  },

  /** Envía la respuesta del usuario a una pregunta interactiva abierta. */
  provideUserAnswer(answer: string, taskId?: string): Promise<OkResponse> {
    return post(
      "/api/jarvis/user-answer",
      { answer, ...(taskId ? { taskId } : {}) },
      "Error al enviar respuesta interactiva"
    );
  },

  /** Aprueba una operación sensible pendiente de Guard. */
  approvePending(taskId?: string, waitId?: string): Promise<OkResponse> {
    return post("/api/jarvis/approve", taskBody(taskId, waitId), "Error al aprobar la operación");
  },

  /** Deniega una operación pendiente de Guard con motivo opcional. */
  denyPending(reason?: string, taskId?: string, waitId?: string): Promise<OkResponse> {
    return post(
      "/api/jarvis/deny",
      taskBody(taskId, waitId, { reason }),
      "Error al denegar la operación"
    );
  },

  /**
   * Refresca el catálogo de Discovery forzando relectura de servidores stdio.
   */
  async refreshDiscovery(): Promise<DiscoveryResponse> {
    const data = await request<DiscoveryResponse>(
      "/api/jarvis/refresh-discovery",
      "Error al refrescar el catálogo de herramientas",
      { method: "POST" }
    );
    if (data.error) throw new Error(data.error);
    return data;
  },

  /** Obtiene la configuración actual de servicios externos. */
  getConfig(): Promise<JarvisConfig> {
    return request<JarvisConfig>("/api/jarvis/config", "Error al obtener la configuración");
  },

  /** Actualiza la configuración en el backend (parche parcial). */
  updateConfig(patch: ConfigPatch): Promise<JarvisConfig> {
    return post<JarvisConfig>("/api/jarvis/config", patch, "Error al guardar la configuración");
  },

  /** Obtiene la información del entorno del sistema y carpetas conocidas de la PC. */
  getEnvironment(): Promise<UserEnvironment> {
    return request<UserEnvironment>("/api/jarvis/environment", "Error al obtener el entorno");
  },

  /** Obtiene los límites de presupuesto y ejecución del motor JARVIS. */
  getLimits(): Promise<EngineLimits> {
    return request<EngineLimits>("/api/jarvis/limits", "Error al obtener los límites");
  },

  /** Obtiene el texto crudo de una referencia de la tarea. */
  getRefContent(taskId: string, refId: string): Promise<string> {
    return requestText(
      `/api/jarvis/tasks/${encodeURIComponent(taskId)}/refs/${encodeURIComponent(refId)}`,
      "Error al obtener el contenido de la referencia"
    );
  },

  /** Obtiene la traza de auditoría de una tarea terminada (formato summary Markdown o json). */
  getTrace(taskId: string, format: "summary" | "json" | "full" = "summary"): Promise<string> {
    return requestText(
      `/api/jarvis/tasks/${encodeURIComponent(taskId)}/trace?format=${encodeURIComponent(format)}`,
      "Error al obtener la traza de la tarea"
    );
  },
};
