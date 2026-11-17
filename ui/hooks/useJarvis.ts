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
  UserEnvironment,
  EngineLimits,
} from "../types/api.ts";
import { jarvisApi } from "../services/jarvisApi.ts";
import { getApiUrl } from "../utils/apiUrl.ts";
import { useSpeakNewResults, useSpeech } from "./useSpeech.ts";

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
  const stateReqSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [task, setTask] = useState<TaskDto | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [discoveredTools, setDiscoveredTools] = useState<Record<string, McpToolDto[]>>({});
  const [unavailableServers, setUnavailableServers] = useState<UnavailableServers>({});
  const [mode, setMode] = useState<ExecutionMode>("reactive");
  const [error, setError] = useState<string | null>(null);
  const [mcpInitStatus, setMcpInitStatus] = useState<McpInitStatus>("loading");
  const [environment, setEnvironment] = useState<UserEnvironment | null>(null);
  const [limits, setLimits] = useState<EngineLimits | null>(null);
  const [autoMode, setAutoMode] = useState<boolean>(false);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(false);
  const { speak, stop: stopSpeech, status: speechStatus } = useSpeech(setError);
  useSpeakNewResults(task?.task.id ?? null, task?.result?.text ?? null, voiceEnabled, speak, stopSpeech);

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

  const fetchState = useCallback(async (explicitTaskId?: string) => {
    const reqSeq = ++stateReqSeqRef.current;
    try {
      const qTaskId = explicitTaskId || activeTaskIdRef.current || undefined;
      const data = await jarvisApi.getState(qTaskId);
      if (reqSeq !== stateReqSeqRef.current) return;

      if (data.tasks) {
        setTasks(data.tasks);
      }

      if (data.task) {
        const fetched = data.task;
        const currentViewedId = activeTaskIdRef.current;
        const isViewingExplicit = Boolean(explicitTaskId && fetched.task.id === explicitTaskId);
        const isSameViewedTask = Boolean(currentViewedId && fetched.task.id === currentViewedId);
        const isInitialLoad = !isInitialSnapshotLoaded.current && !userClearedViewRef.current;
        const canAutoShowNew = !currentViewedId && !userClearedViewRef.current;

        if (isViewingExplicit || isSameViewedTask || isInitialLoad || canAutoShowNew) {
          const isNewViewedTask = currentViewedId !== fetched.task.id;
          isInitialSnapshotLoaded.current = true;
          userClearedViewRef.current = false;
          activeTaskIdRef.current = fetched.task.id;
          taskRef.current = fetched;
          setTask(fetched);
          if (fetched.task.mode && (isNewViewedTask || fetched.task.state === "running")) {
            setMode(fetched.task.mode);
          }
        }
      } else if (!activeTaskIdRef.current) {
        isInitialSnapshotLoaded.current = true;
        setTask(null);
        taskRef.current = null;
      }

      setDiscoveredTools(data.discoveredTools ?? {});
      setUnavailableServers(data.unavailableServers ?? {});
      setMcpInitStatus(
        resolveMcpStatus(countKeys(data.discoveredTools), countKeys(data.unavailableServers), "loading")
      );
    } catch (err) {
      if (reqSeq !== stateReqSeqRef.current) return;
      console.warn("Failed to fetch JARVIS state from backend:", err);
      setMcpInitStatus((prev) => (prev === "loading" ? "error" : prev));
    }
  }, []);

  const fetchStateRef = useRef(fetchState);
  useEffect(() => {
    fetchStateRef.current = fetchState;
  }, [fetchState]);

  const scheduleFetchState = useCallback((eventTaskId?: string, eventType?: SseMessage["type"]) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      const viewedId = activeTaskIdRef.current;
      // Si ya estamos viendo una tarea, refrescamos esa misma tarea (no secuestramos la vista con otra).
      // Si no hay tarea en vista y el usuario no la limpió, permitimos mostrar una recién creada.
      const target = viewedId
        ? viewedId
        : !userClearedViewRef.current && eventType === "created" && eventTaskId
          ? eventTaskId
          : undefined;
      void fetchStateRef.current(target);
    }, DEBOUNCE_STATE_MS);
  }, []);

  // -------------------------------------------------------------------------
  // Conexión SSE persistente
  // -------------------------------------------------------------------------

  useEffect(() => {
    void fetchStateRef.current();
    void jarvisApi.getEnvironment().then(setEnvironment).catch(() => {});
    void jarvisApi.getLimits().then(setLimits).catch(() => {});
    void jarvisApi.getConfig().then((cfg) => { setAutoMode(Boolean(cfg.autoMode)); setVoiceEnabled(Boolean(cfg.voiceEnabled)); }).catch(() => {});

    let eventSource: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let hasOpenedOnce = false;

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

      eventSource.onopen = () => {
        stopFallbackPolling();
        if (hasOpenedOnce) {
          void fetchStateRef.current();
        }
        hasOpenedOnce = true;
      };

      eventSource.onmessage = (msgEvent) => {
        try {
          if (!msgEvent.data || msgEvent.data.trim().startsWith(":")) {
            return;
          }
          const data = JSON.parse(msgEvent.data) as SseMessage;
          if (data?.type === "paused" && data.taskId) {
            setTask((prev) => {
              if (!prev || prev.task.id !== data.taskId) return prev;
              const next = { ...prev, paused: data.paused };
              taskRef.current = next;
              return next;
            });
          }
          if (data && data.taskId) {
            scheduleFetchState(data.taskId, data.type);
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
        stateReqSeqRef.current++;
        isInitialSnapshotLoaded.current = true;
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
        const targetId = resolveTaskId(explicitTaskId);
        const result = await jarvisApi.cancelTask(targetId);
        await fetchState(activeTaskIdRef.current || undefined);
        return result;
      }, "Error al cancelar la tarea.");
      return Boolean(res);
    },
    [runAction, resolveTaskId, fetchState]
  );

  const confirmPlan = useCallback(
    (): Promise<boolean> =>
      runAccepted(async () => {
        const targetId = resolveTaskId();
        await jarvisApi.confirmPlan(targetId, resolveWaitId());
        await fetchState(targetId);
      }, "Error al confirmar el plan."),
    [runAccepted, resolveTaskId, resolveWaitId, fetchState]
  );

  const rejectPlan = useCallback(
    (): Promise<boolean> =>
      runAccepted(async () => {
        const targetId = resolveTaskId();
        await jarvisApi.rejectPlan(targetId, resolveWaitId());
        await fetchState(targetId);
      }, "Error al rechazar el plan."),
    [runAccepted, resolveTaskId, resolveWaitId, fetchState]
  );

  const modifyPlan = useCallback(
    (feedback: string): Promise<boolean> =>
      runAccepted(async () => {
        const targetId = resolveTaskId();
        await jarvisApi.modifyPlan(feedback, targetId, resolveWaitId());
        await fetchState(targetId);
      }, "Error al solicitar modificación del plan."),
    [runAccepted, resolveTaskId, resolveWaitId, fetchState]
  );

  const provideUserAnswer = useCallback(
    (answer: string): Promise<boolean> =>
      runAccepted(async () => {
        const targetId = resolveTaskId();
        await jarvisApi.provideUserAnswer(answer, targetId);
        await fetchState(targetId);
      }, "Error al enviar respuesta interactiva."),
    [runAccepted, resolveTaskId, fetchState]
  );

  const approvePending = useCallback(
    async (explicitTaskId?: string, explicitWaitId?: string, remember = false): Promise<boolean> =>
      runAccepted(async () => {
        const targetId = resolveTaskId(explicitTaskId);
        await jarvisApi.approvePending(
          targetId,
          explicitWaitId || resolveWaitId(),
          remember
        );
        await fetchState(targetId);
      }, "Error al aprobar la operación pendiente."),
    [runAccepted, resolveTaskId, resolveWaitId, fetchState]
  );

  const denyPending = useCallback(
    async (reason?: string, explicitTaskId?: string, explicitWaitId?: string): Promise<boolean> =>
      runAccepted(async () => {
        const targetId = resolveTaskId(explicitTaskId);
        await jarvisApi.denyPending(
          reason,
          targetId,
          explicitWaitId || resolveWaitId()
        );
        await fetchState(targetId);
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

  const refreshConfig = useCallback(async () => {
    try {
      const cfg = await jarvisApi.getConfig();
      setAutoMode(Boolean(cfg.autoMode));
      setVoiceEnabled(Boolean(cfg.voiceEnabled));
    } catch (e) {
      console.warn("Failed to refresh config in hook:", e);
    }
  }, []);

  const toggleAutoMode = useCallback(async (forced?: boolean) => {
    const nextVal = forced !== undefined ? forced : !autoMode;
    try {
      const updated = await jarvisApi.updateConfig({ autoMode: nextVal });
      setAutoMode(Boolean(updated.autoMode));
      return Boolean(updated.autoMode);
    } catch (err) {
      console.error("Error updating autoMode:", err);
      setError(err instanceof Error ? err.message : "Error al actualizar modo automático");
      return autoMode;
    }
  }, [autoMode]);

  const clearTaskView = useCallback(() => {
    stateReqSeqRef.current++;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    userClearedViewRef.current = true;
    activeTaskIdRef.current = null;
    taskRef.current = null;
    setTask(null);
    setError(null);
  }, []);

  const selectHistoricalTask = useCallback(
    async (taskId: string) => {
      const reqSeq = ++stateReqSeqRef.current;
      try {
        const data = await jarvisApi.getState(taskId);
        if (reqSeq !== stateReqSeqRef.current) return;
        if (data.tasks) {
          setTasks(data.tasks);
        }
        if (data.task?.task.id === taskId) {
          isInitialSnapshotLoaded.current = true;
          userClearedViewRef.current = false;
          activeTaskIdRef.current = taskId;
          taskRef.current = data.task;
          setTask(data.task);
          if (data.task.task.mode) {
            setMode(data.task.task.mode);
          }
          setError(null);
        } else {
          setError("La tarea seleccionada ya no está disponible en el servidor.");
        }
      } catch (e) {
        if (reqSeq !== stateReqSeqRef.current) return;
        console.warn("Failed to retrieve historical task:", e);
        setError(e instanceof Error && e.message ? e.message : "No se pudo cargar la tarea seleccionada.");
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  const waiting = task?.waiting ?? null;
  const paused = task?.task.state === "running" ? (task.paused ?? null) : null;
  const isExecuting = task?.task.state === "running";
  const isWaiting = waiting !== null;
  const isPaused = paused !== null;

  return {
    task,
    allTasks: tasks,
    mode,
    setMode,
    waiting,
    waitingKind: waiting?.kind ?? null,
    isWaiting,
    paused,
    isPaused,
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
    refreshConfig,
    environment,
    limits,
    autoMode,
    voiceEnabled,
    speechStatus,
    speak,
    stopSpeech,
    toggleAutoMode,
    clearTaskView,
    selectHistoricalTask,
  };
}
