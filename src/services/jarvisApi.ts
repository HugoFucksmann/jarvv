/**
 * Client API Service for JARVIS Backend
 * Centralizes all HTTP communications with /api/jarvis/* and /api/mcp/*
 */

import { getApiUrl } from "../utils/apiUrl.ts";
import type { Task, MCPTool } from "../core/types.ts";
import type { MCPPrompt, MCPResourceTemplate } from "../core/mcp/types.ts";
import type { JarvisConfig } from "../core/config.ts";

export interface SerializedPendingApproval {
  id: string;
  stepId: string;
  mcp: string;
  tool: string;
  capability: any;
  args: Record<string, unknown>;
  reason: string;
}

export interface StateResponse {
  task: Task | null;
  pendingApproval: SerializedPendingApproval | null;
  allTasks: Task[];
  discoveredTools: Record<string, MCPTool[]>;
  extraCapabilities: {
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  };
  unavailableServers: Record<string, { reason: string; since: number }>;
}

export interface DiscoveryResponse {
  tools: Record<string, MCPTool[]>;
  extraCapabilities: {
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  };
  unavailableServers?: Record<string, { reason: string; since: number }>;
  error?: string;
}

async function handleResponse<T>(res: Response, defaultErrorMsg: string): Promise<T> {
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `${defaultErrorMsg} (HTTP ${res.status})`);
  }
  return res.json();
}

export const jarvisApi = {
  /**
   * Obtiene el snapshot de estado del backend.
   */
  async getState(taskId?: string): Promise<StateResponse> {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
    const res = await fetch(getApiUrl(`/api/jarvis/state${query}`));
    return handleResponse<StateResponse>(res, "Error al obtener el estado");
  },

  /**
   * Consulta el texto íntegro almacenado bajo una referencia de RefStore (Hallazgo #10).
   */
  async getRef(refKey: string, taskId?: string): Promise<{ refKey: string; content: string; found: boolean }> {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
    const res = await fetch(getApiUrl(`/api/jarvis/ref/${encodeURIComponent(refKey)}${query}`));
    return handleResponse(res, `Error al obtener referencia ${refKey}`);
  },

  /**
   * Inicia una nueva tarea en el backend.
   */
  async initiateTask(message: string, mode: "NORMAL" | "PLAN"): Promise<{ task: Task }> {
    const res = await fetch(getApiUrl("/api/jarvis/process"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim(), mode }),
    });
    return handleResponse<{ task: Task }>(res, "Error al iniciar la tarea");
  },

  /**
   * Cancela una tarea activa. Si no se provee taskId, se omite para que el backend cancele la tarea en ejecución.
   */
  async cancelTask(taskId?: string): Promise<{ ok: boolean }> {
    const body: Record<string, unknown> = {};
    if (taskId) {
      body.taskId = taskId;
    }
    const res = await fetch(getApiUrl("/api/jarvis/cancel"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse<{ ok: boolean }>(res, "Error al cancelar la tarea");
  },

  /**
   * Confirma la ejecución de un plan en modo PLAN.
   */
  async confirmPlan(taskId?: string): Promise<{ ok: boolean }> {
    const body: Record<string, unknown> = {};
    if (taskId) {
      body.taskId = taskId;
    }
    const res = await fetch(getApiUrl("/api/jarvis/confirm-plan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse<{ ok: boolean }>(res, "Error al confirmar el plan");
  },

  /**
   * Rechaza el plan propuesto con motivo opcional.
   */
  async rejectPlan(taskId?: string, reason?: string): Promise<{ ok: boolean }> {
    const body: Record<string, unknown> = {};
    if (taskId) {
      body.taskId = taskId;
    }
    if (reason) {
      body.reason = reason;
    }
    const res = await fetch(getApiUrl("/api/jarvis/reject-plan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse<{ ok: boolean }>(res, "Error al rechazar el plan");
  },

  /**
   * Solicita modificación de un plan en modo PLAN enviando feedback correctivo.
   */
  async modifyPlan(taskId?: string, feedback?: string): Promise<{ ok: boolean }> {
    const body: Record<string, unknown> = {};
    if (taskId) {
      body.taskId = taskId;
    }
    if (feedback) {
      body.feedback = feedback;
    }
    const res = await fetch(getApiUrl("/api/jarvis/modify-plan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse<{ ok: boolean }>(res, "Error al solicitar modificación del plan");
  },

  /**
   * Envía respuesta del usuario a una solicitud interactiva en WAITING_INPUT (user_answer).
   */
  async provideUserAnswer(taskId?: string, answer: string = ""): Promise<{ ok: boolean }> {
    const body: Record<string, unknown> = { answer };
    if (taskId) {
      body.taskId = taskId;
    }
    const res = await fetch(getApiUrl("/api/jarvis/user-answer"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse<{ ok: boolean }>(res, "Error al enviar respuesta interactiva");
  },

  /**
   * Aprueba una operación pendiente bloqueada por Guard.
   */
  async approvePending(taskId?: string): Promise<{ ok: boolean }> {
    const body: Record<string, unknown> = {};
    if (taskId) {
      body.taskId = taskId;
    }
    const res = await fetch(getApiUrl("/api/jarvis/approve"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse<{ ok: boolean }>(res, "Error al aprobar la operación");
  },

  /**
   * Deniega una operación pendiente de Guard con motivo opcional.
   */
  async denyPending(taskId?: string, reason?: string): Promise<{ ok: boolean }> {
    const body: Record<string, unknown> = {};
    if (taskId) {
      body.taskId = taskId;
    }
    if (reason) {
      body.reason = reason;
    }
    const res = await fetch(getApiUrl("/api/jarvis/deny"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return handleResponse<{ ok: boolean }>(res, "Error al denegar la operación");
  },

  /**
   * Refresca el catálogo de Discovery forzando relectura de servidores stdio.
   */
  async refreshDiscovery(): Promise<DiscoveryResponse> {
    const res = await fetch(getApiUrl("/api/jarvis/refresh-discovery"), {
      method: "POST",
    });
    return handleResponse<DiscoveryResponse>(res, "Error al refrescar el catálogo de herramientas");
  },

  /**
   * Obtiene la configuración actual de servicios externos.
   */
  async getConfig(): Promise<JarvisConfig> {
    const res = await fetch(getApiUrl("/api/jarvis/config"));
    return handleResponse<JarvisConfig>(res, "Error al obtener la configuración");
  },

  /**
   * Actualiza la configuración en el backend.
   */
  async updateConfig(config: Partial<JarvisConfig>): Promise<JarvisConfig> {
    const res = await fetch(getApiUrl("/api/jarvis/config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return handleResponse<JarvisConfig>(res, "Error al guardar la configuración");
  },

  /**
   * Solicita la reconexión de un servidor MCP específico por stdio.
   */
  async reconnectMcpServer(server: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(getApiUrl(`/api/mcp/${encodeURIComponent(server)}/reconnect`), {
      method: "POST",
    });
    return handleResponse<{ ok: boolean; error?: string }>(res, `Error al reconectar ${server}`);
  },

  /**
   * Consulta el estado de conexión de un servidor MCP.
   */
  async getMcpServerStatus(server: string): Promise<{ connected: boolean }> {
    const res = await fetch(getApiUrl(`/api/mcp/${encodeURIComponent(server)}/status`));
    return handleResponse<{ connected: boolean }>(res, `Error al consultar estado de ${server}`);
  },

  /**
   * Lee un recurso específico de un servidor MCP (por ejemplo cache:// en Free Search).
   */
  async readMcpResource(server: string, uri: string): Promise<{ text: string }> {
    const res = await fetch(getApiUrl(`/api/mcp/${encodeURIComponent(server)}/resources`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri }),
    });
    return handleResponse<{ text: string }>(res, `Error al leer recurso ${uri}`);
  },
};
