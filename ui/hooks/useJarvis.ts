/**
 * React Hook for JARVIS Client
 *
 * Se comunica exclusivamente con el backend JARVIS vía HTTP y SSE (/api/jarvis/*).
 * Consume el nuevo modelo de datos unificado (TaskDto) y reacciona a eventos SSE
 * con debouncing hacia GET /state, según la especificación de JARVIS_API.md.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ExecutionMode,
  McpInitStatus,
} from "../types/ui.ts";
import type {
  TaskDto,
  TaskSummary,
  McpToolDto,
  UnavailableServers,
  SseMessage,
} from "../types/api.ts";
import { jarvisApi } from "../services/jarvisApi.ts";
import { getApiUrl } from "../utils/apiUrl.ts";

export type { ExecutionMode, McpInitStatus } from "../types/ui.ts";

const FALLBACK_POLL_MS = 5000;
const DEBOUNCE_STATE_MS = 80;

const countKeys = (obj?: object | null): number => (obj ? Object.keys(obj).length : 0);

function resolveMcpStatus(
  discovered: number,
  unavailable: number,
  whenEmpty: McpInitStatus
): McpInitStatus {
  if (discovered === 0 && unavailable === 0) return whenEmpty;
  if (unavailable === 0) return "ready";
  return discovered > 0 ? "partial" : "error";
}

export function useJarvis() {
  const activeTaskIdRef = useRef<string | null>(null);
  const taskRef = useRef<TaskDto | null>(null);
  const isInitialSnapshotLoaded = useRef(false);
  const userClearedViewRef = useRef(false);
  const mcpInitDoneRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [task, setTask] = useState<TaskDto | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [discoveredTools, setDiscoveredTools] = useState<Record<string, McpToolDto[]>>({});
  const [unavailableServers, setUnavailableServers] = useState<UnavailableServers>({});
  const [mode, setMode] = useState<ExecutionMode>("reactive");
  const [error, setError] = useState<string | null>(null);
  const [mcpInitStatus, setMcpInitStatus] = useState<McpInitStatus>("loading");

  useEffect(() => {
    taskRef.current = task;
    if (task?.task.id) {
      activeTaskIdRef.current = task.task.id;
    }
  }, [task]);

  const resolveTaskId = useCallback(
    (explicit?: string): string | undefined =>
      explicit?.trim() ? explicit : activeTaskIdRef.current || taskRef.current?.task.id || undefined,
    []
  );

  const resolveWaitId = useCallback((): string | undefined => {
    const current = taskRef.current?.waiting;
    if (!current) return undefined;
    if (current.kind === "plan" || current.kind === "approval") {
      return current.request.id;
    }
    return undefined;
  }, []);

  const runAction = useCallback(
    async <T>(action: () => Promise<T>, fallbackMessage: string): Promise<T | undefined> => {
      try {
        setError(null);
        return await action();
      } catch (err) {
        console.error(fallbackMessage, err);
        setError(err instanceof Error && err.message ? err.message : fallbackMessage);
        return undefined;
      }
    },
    []
  );

  const runAccepted = useCallback(
    async (action: () => Promise<unknown>, fallbackMessage: string): Promise<boolean> =>
      (await runAction(async () => {
        await action();
        return true;
      }, fallbackMessage)) === true,
    [runAction]
  );

  // -------------------------------------------------------------------------
  // Snapshot de estado
  // -------------------------------------------------------------------------

  const fetchState = useCallback(async (targetTaskId?: string) => {
    try {
      const qTaskId = targetTaskId || activeTaskIdRef.current || undefined;
      const data = await jarvisApi.getState(qTaskId);

      if (data.tasks) {
        setTasks(data.tasks);
      }

      if (data.task) {
        const fetched = data.task;
        const shouldShow =
          !isInitialSnapshotLoaded.current ||
          !userClearedViewRef.current ||
          fetched.task.state === "running" ||
          (activeTaskIdRef.current && fetched.task.id === activeTaskIdRef.current);

        if (shouldShow) {
          isInitialSnapshotLoaded.current = true;
          userClearedViewRef.current = false;
          activeTaskIdRef.current = fetched.task.id;
          taskRef.current = fetched;
          setTask(fetched);
          if (fetched.task.mode) {
            setMode(fetched.task.mode);
          }
        }
      } else if (!activeTaskIdRef.current) {
        // No hay tareas en el servidor
        setTask(null);
        taskRef.current = null;
      }

      if (countKeys(data.discoveredTools) > 0) {
        setDiscoveredTools(data.discoveredTools);
      }
      if (data.unavailableServers) {
        setUnavailableServers(data.unavailableServers);
      }

      if (!mcpInitDoneRef.current) {
        mcpInitDoneRef.current = true;
        setMcpInitStatus(
          resolveMcpStatus(countKeys(data.discoveredTools), countKeys(data.unavailableServers), "loading")
        );
      }
    } catch (err) {
      console.warn("Failed to fetch JARVIS state from backend:", err);
      if (!mcpInitDoneRef.current) {
        mcpInitDoneRef.current = true;
        setMcpInitStatus("error");
      }
    }
  }, []);

  const fetchStateRef = useRef(fetchState);
  useEffect(() => {
    fetchStateRef.current = fetchState;
  }, [fetchState]);

  const scheduleFetchState = useCallback((targetTaskId?: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      void fetchStateRef.current(targetTaskId);
    }, DEBOUNCE_STATE_MS);
  }, []);

  // -------------------------------------------------------------------------
  // Conexión SSE persistente
  // -------------------------------------------------------------------------

  useEffect(() => {
    void fetchStateRef.current();

    let eventSource: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startFallbackPolling = () => {
      if (!pollTimer) {
        pollTimer = setInterval(() => void fetchStateRef.current(), FALLBACK_POLL_MS);
      }
    };

    const stopFallbackPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    try {
      eventSource = new EventSource(getApiUrl("/api/jarvis/events"));

      eventSource.onopen = stopFallbackPolling;

      eventSource.onmessage = (msgEvent) => {
        try {
          if (!msgEvent.data || msgEvent.data.trim().startsWith(":")) {
            return;
          }
          const data = JSON.parse(msgEvent.data) as SseMessage;
          if (data && data.taskId) {
            scheduleFetchState(data.taskId);
          } else {
            scheduleFetchState();
          }
        } catch {
          // Ignorar comentarios o mensajes no-JSON
        }
      };

      eventSource.onerror = () => {
        startFallbackPolling();
        void fetchStateRef.current();
      };
    } catch (err) {
      console.warn("EventSource failed to connect:", err);
      startFallbackPolling();
    }

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      eventSource?.close();
      stopFallbackPolling();
    };
  }, [scheduleFetchState]);

  // -------------------------------------------------------------------------
  // Acciones sobre la tarea
  // -------------------------------------------------------------------------

  const runTask = useCallback(
    async (message: string, executionMode?: ExecutionMode): Promise<boolean> => {
      if (!message.trim()) return false;

      const effectiveMode = executionMode || mode;
      if (executionMode && executionMode !== mode) {
        setMode(executionMode);
      }

      return runAccepted(async () => {
        const data = await jarvisApi.initiateTask(message, effectiveMode);
        userClearedViewRef.current = false;
        activeTaskIdRef.current = data.task.task.id;
        taskRef.current = data.task;
        setTask(data.task);
      }, "Error al iniciar la tarea.");
    },
    [mode, runAccepted]
  );

  const cancelTask = useCallback(
    async (explicitTaskId?: string): Promise<boolean> => {
      const res = await runAction(async () => {
        const result = await jarvisApi.cancelTask(resolveTaskId(explicitTaskId));
        await fetchState();
        return result;
      }, "Error al cancelar la tarea.");
      return Boolean(res);
    },
    [runAction, resolveTaskId, fetchState]
  );

  const confirmPlan = useCallback(
    (): Promise<boolean> =>
      runAccepted(async () => {
        await jarvisApi.confirmPlan(resolveTaskId(), resolveWaitId());
        await fetchState();
      }, "Error al confirmar el plan."),
    [runAccepted, resolveTaskId, resolveWaitId, fetchState]
  );

  const rejectPlan = useCallback(
    (): Promise<boolean> =>
      runAccepted(async () => {
        await jarvisApi.rejectPlan(resolveTaskId(), resolveWaitId());
        await fetchState();
      }, "Error al rechazar el plan."),
    [runAccepted, resolveTaskId, resolveWaitId, fetchState]
  );

  const modifyPlan = useCallback(
    (feedback: string): Promise<boolean> =>
      runAccepted(async () => {
        await jarvisApi.modifyPlan(feedback, resolveTaskId(), resolveWaitId());
        await fetchState();
      }, "Error al solicitar modificación del plan."),
    [runAccepted, resolveTaskId, resolveWaitId, fetchState]
  );

  const provideUserAnswer = useCallback(
    (answer: string): Promise<boolean> =>
      runAccepted(async () => {
        await jarvisApi.provideUserAnswer(answer, resolveTaskId());
        await fetchState();
      }, "Error al enviar respuesta interactiva."),
    [runAccepted, resolveTaskId, fetchState]
  );

  const approvePending = useCallback(
    async (explicitTaskId?: string, explicitWaitId?: string): Promise<boolean> =>
      runAccepted(async () => {
        await jarvisApi.approvePending(
          resolveTaskId(explicitTaskId),
          explicitWaitId || resolveWaitId()
        );
        await fetchState();
      }, "Error al aprobar la operación pendiente."),
    [runAccepted, resolveTaskId, resolveWaitId, fetchState]
  );

  const denyPending = useCallback(
    async (reason?: string, explicitTaskId?: string, explicitWaitId?: string): Promise<boolean> =>
      runAccepted(async () => {
        await jarvisApi.denyPending(
          reason,
          resolveTaskId(explicitTaskId),
          explicitWaitId || resolveWaitId()
        );
        await fetchState();
      }, "Error al denegar la operación pendiente."),
    [runAccepted, resolveTaskId, resolveWaitId, fetchState]
  );

  const refreshDiscovery = useCallback(async () => {
    setMcpInitStatus("loading");
    const data = await runAction(
      () => jarvisApi.refreshDiscovery(),
      "Error al refrescar el catálogo de herramientas."
    );
    if (!data) {
      setMcpInitStatus("error");
      return;
    }
    setDiscoveredTools(data.tools);
    if (data.unavailableServers) setUnavailableServers(data.unavailableServers);
    setMcpInitStatus(resolveMcpStatus(countKeys(data.tools), countKeys(data.unavailableServers), "error"));
  }, [runAction]);

  const clearTaskView = useCallback(() => {
    userClearedViewRef.current = true;
    activeTaskIdRef.current = null;
    taskRef.current = null;
    setTask(null);
    setError(null);
  }, []);

  const selectHistoricalTask = useCallback(
    async (taskId: string) => {
      try {
        const data = await jarvisApi.getState(taskId);
        if (data.task?.task.id === taskId) {
          userClearedViewRef.current = false;
          activeTaskIdRef.current = taskId;
          taskRef.current = data.task;
          setTask(data.task);
          if (data.task.task.mode) {
            setMode(data.task.task.mode);
          }
          setError(null);
        }
      } catch (e) {
        console.warn("Failed to retrieve historical task:", e);
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  const waiting = task?.waiting ?? null;
  const isExecuting = task?.task.state === "running";
  const isWaiting = waiting !== null;

  return {
    task,
    allTasks: tasks,
    mode,
    setMode,
    waiting,
    waitingKind: waiting?.kind ?? null,
    isWaiting,
    isExecuting,
    discoveredTools,
    unavailableServers,
    mcpInitStatus,
    error,
    clearError,
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
