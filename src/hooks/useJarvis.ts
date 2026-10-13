/**
 * React Hook for JARVIS Client
 * 
 * Communicates exclusively with the authoritative Node.js JARVIS backend via HTTP / SSE.
 * Does NOT instantiate or bundle JarvisCore, DiscoveryEngine, Decision20Engine,
 * QwenEngine, child_process, or any MCP transport inside the browser.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { Task, PendingApproval, CoreEvent, MCPTool } from "../core/types.ts";
import type { MCPPrompt, MCPResourceTemplate } from "../core/mcp/types.ts";
import { jarvisApi } from "../services/jarvisApi.ts";
import { getApiUrl } from "../utils/apiUrl.ts";

export function useJarvis() {
  const activeTaskIdRef = useRef<string | null>(null);
  const isInitialSnapshotLoaded = useRef<boolean>(false);
  const userClearedViewRef = useRef<boolean>(false);

  const [task, setTask] = useState<Task | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [events, setEvents] = useState<CoreEvent[]>([]);
  const [discoveredTools, setDiscoveredTools] = useState<Record<string, MCPTool[]>>({});
  const [extraCapabilities, setExtraCapabilities] = useState<{
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  }>({ prompts: {}, resourceTemplates: {} });
  const [unavailableServers, setUnavailableServers] = useState<Record<string, { reason: string; since: number }>>({});
  const [mode, setMode] = useState<"NORMAL" | "PLAN">("NORMAL");
  const [error, setError] = useState<string | null>(null);

  // Approve action (resolves taskId safely without sending null)
  const approvePending = useCallback(async (explicitTaskId?: string) => {
    const tid = explicitTaskId || activeTaskIdRef.current || task?.id || undefined;
    try {
      setError(null);
      await jarvisApi.approvePending(tid);
      setPendingApproval(null);
    } catch (err: any) {
      console.error("Error approving pending step:", err);
      setError(err.message || "Error al aprobar la operación pendiente.");
    }
  }, [task?.id]);

  // Deny action (resolves taskId safely without sending null)
  const denyPending = useCallback(async (reason?: string, explicitTaskId?: string) => {
    const tid = explicitTaskId || activeTaskIdRef.current || task?.id || undefined;
    try {
      setError(null);
      await jarvisApi.denyPending(tid, reason);
      setPendingApproval(null);
    } catch (err: any) {
      console.error("Error denying pending step:", err);
      setError(err.message || "Error al denegar la operación pendiente.");
    }
  }, [task?.id]);

  // Hydrate PendingApproval object with interactive handlers for UI
  const hydratePendingApproval = useCallback(
    (raw: any, fallbackTaskId?: string): PendingApproval | null => {
      if (!raw) return null;
      const associatedTaskId = raw.taskId || fallbackTaskId || activeTaskIdRef.current || task?.id;
      return {
        id: raw.id,
        stepId: raw.stepId,
        mcp: raw.mcp,
        tool: raw.tool,
        capability: raw.capability,
        args: raw.args || {},
        reason: raw.reason || "",
        onApprove: () => {
          approvePending(associatedTaskId);
        },
        onDeny: (denyReason?: string) => {
          denyPending(denyReason, associatedTaskId);
        },
      };
    },
    [approvePending, denyPending, task?.id]
  );

  // Fetch full state snapshot from backend
  const fetchState = useCallback(async () => {
    try {
      const data = await jarvisApi.getState(activeTaskIdRef.current || undefined);
      if (data.allTasks) {
        setAllTasks(data.allTasks);
      }
      if (data.task) {
        if (!isInitialSnapshotLoaded.current) {
          isInitialSnapshotLoaded.current = true;
          activeTaskIdRef.current = data.task.id;
          setTask(data.task);
        } else if (!userClearedViewRef.current || data.task.state === "RUNNING") {
          activeTaskIdRef.current = data.task.id;
          setTask(data.task);
        }
      }
      if (data.pendingApproval) {
        setPendingApproval(hydratePendingApproval(data.pendingApproval, data.task?.id));
      } else {
        setPendingApproval(null);
      }
      if (data.discoveredTools && Object.keys(data.discoveredTools).length > 0) {
        setDiscoveredTools(data.discoveredTools);
      }
      if (data.extraCapabilities) {
        setExtraCapabilities(data.extraCapabilities);
      }
      if (data.unavailableServers) {
        setUnavailableServers(data.unavailableServers);
      }
    } catch (err: any) {
      console.warn("Failed to fetch JARVIS state from backend:", err);
    }
  }, [hydratePendingApproval]);

  // Subscribe to real-time events via Server-Sent Events (SSE)
  useEffect(() => {
    fetchState();

    let eventSource: EventSource | null = null;
    let fallbackPollInterval: NodeJS.Timeout | null = null;

    const startFallbackPolling = () => {
      if (!fallbackPollInterval) {
        fallbackPollInterval = setInterval(() => {
          fetchState();
        }, 5000);
      }
    };

    const stopFallbackPolling = () => {
      if (fallbackPollInterval) {
        clearInterval(fallbackPollInterval);
        fallbackPollInterval = null;
      }
    };

    try {
      eventSource = new EventSource(getApiUrl("/api/jarvis/events"));

      eventSource.onopen = () => {
        stopFallbackPolling();
      };

      eventSource.onmessage = (messageEvent) => {
        try {
          const payload = JSON.parse(messageEvent.data);
          const { event, task: updatedTask, pendingApproval: rawPending } = payload;

          if (event) {
            if (!activeTaskIdRef.current || event.taskId === activeTaskIdRef.current) {
              setEvents((prev) => [...prev.slice(-49), event]);
            }
          }

          if (updatedTask) {
            // Prevenir que SSE restaure inesperadamente una tarea inactiva si el usuario limpió la vista
            const matchesActive = activeTaskIdRef.current && updatedTask.id === activeTaskIdRef.current;
            const isFreshRunningTask = !activeTaskIdRef.current && updatedTask.state === "RUNNING";

            if (matchesActive || isFreshRunningTask) {
              userClearedViewRef.current = false;
              activeTaskIdRef.current = updatedTask.id;
              setTask({ ...updatedTask });
            }
          }

          if (rawPending !== undefined) {
            setPendingApproval(hydratePendingApproval(rawPending, updatedTask?.id));
          }
        } catch (e) {
          console.error("Failed to parse JARVIS SSE message:", e);
        }
      };

      eventSource.onerror = () => {
        startFallbackPolling();
        fetchState();
      };
    } catch (err) {
      console.warn("EventSource not supported or failed to connect:", err);
      startFallbackPolling();
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      stopFallbackPolling();
    };
  }, [fetchState, hydratePendingApproval]);

  // Initiate a new task on the backend
  const runTask = useCallback(
    async (message: string, executionMode?: "NORMAL" | "PLAN") => {
      if (!message.trim()) return;
      userClearedViewRef.current = false;
      setEvents([]);
      setError(null);
      const effectiveMode = executionMode || mode;

      if (executionMode && executionMode !== mode) {
        setMode(executionMode);
      }

      try {
        const data = await jarvisApi.initiateTask(message, effectiveMode);
        if (data.task) {
          activeTaskIdRef.current = data.task.id;
          setTask(data.task);
          setPendingApproval(null);
        }
      } catch (err: any) {
        console.error("Failed to initiate task on backend:", err);
        setError(err.message || "Error al iniciar la tarea.");
      }
    },
    [mode]
  );

  // Cancel task
  const cancelTask = useCallback(async () => {
    const tid = activeTaskIdRef.current || task?.id || undefined;
    try {
      setError(null);
      await jarvisApi.cancelTask(tid);
      await fetchState();
    } catch (err: any) {
      console.error("Failed to cancel task on backend:", err);
      setError(err.message || "Error al cancelar la tarea.");
    }
  }, [fetchState, task?.id]);

  // Confirm plan
  const confirmPlan = useCallback(async () => {
    const tid = activeTaskIdRef.current || task?.id || undefined;
    try {
      setError(null);
      await jarvisApi.confirmPlan(tid);
      await fetchState();
    } catch (err: any) {
      console.error("Failed to confirm plan on backend:", err);
      setError(err.message || "Error al confirmar el plan.");
    }
  }, [fetchState, task?.id]);

  // Reject plan
  const rejectPlan = useCallback(async (reason?: string) => {
    const tid = activeTaskIdRef.current || task?.id || undefined;
    try {
      setError(null);
      await jarvisApi.rejectPlan(tid, reason);
      await fetchState();
    } catch (err: any) {
      console.error("Failed to reject plan on backend:", err);
      setError(err.message || "Error al rechazar el plan.");
    }
  }, [fetchState, task?.id]);

  // Modify plan
  const modifyPlan = useCallback(async (feedback?: string) => {
    const tid = activeTaskIdRef.current || task?.id || undefined;
    try {
      setError(null);
      await jarvisApi.modifyPlan(tid, feedback);
      await fetchState();
    } catch (err: any) {
      console.error("Failed to request plan modification on backend:", err);
      setError(err.message || "Error al solicitar modificación del plan.");
    }
  }, [fetchState, task?.id]);

  // Provide user answer to interactive question
  const provideUserAnswer = useCallback(async (answer: string) => {
    const tid = activeTaskIdRef.current || task?.id || undefined;
    try {
      setError(null);
      await jarvisApi.provideUserAnswer(tid, answer);
      await fetchState();
    } catch (err: any) {
      console.error("Failed to submit interactive user answer:", err);
      setError(err.message || "Error al enviar respuesta interactiva.");
    }
  }, [fetchState, task?.id]);

  // Refresh discovery catalog
  const refreshDiscovery = useCallback(async () => {
    try {
      setError(null);
      const data = await jarvisApi.refreshDiscovery();
      if (data.tools) setDiscoveredTools(data.tools);
      if (data.extraCapabilities) setExtraCapabilities(data.extraCapabilities);
      if (data.unavailableServers) setUnavailableServers(data.unavailableServers);
    } catch (err: any) {
      console.warn("Failed to refresh discovery catalog:", err);
      setError(err.message || "Error al refrescar el catálogo de herramientas.");
    }
  }, []);

  // Limpiar vista local para iniciar una nueva consulta sin alterar el historial del backend
  const clearTaskView = useCallback(() => {
    userClearedViewRef.current = true;
    activeTaskIdRef.current = null;
    setTask(null);
    setEvents([]);
    setPendingApproval(null);
    setError(null);
  }, []);

  // Seleccionar tarea previa del historial para visualización de solo lectura
  const selectHistoricalTask = useCallback(
    (taskId: string) => {
      const found = allTasks.find((t) => t.id === taskId);
      if (found) {
        userClearedViewRef.current = false;
        activeTaskIdRef.current = found.id;
        setTask(found);
        setPendingApproval(null);
      }
    },
    [allTasks]
  );

  return {
    task,
    allTasks,
    mode,
    setMode,
    pendingApproval,
    events,
    discoveredTools,
    extraCapabilities,
    unavailableServers,
    error,
    clearError: () => setError(null),
    isExecuting: task?.state === "RUNNING",
    runTask,
    cancelTask,
    confirmPlan,
    rejectPlan,
    modifyPlan,
    provideUserAnswer,
    approvePending,
    denyPending,
    refreshDiscovery,
    clearTaskView,
    selectHistoricalTask,
  };
}
