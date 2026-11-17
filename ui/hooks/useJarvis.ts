/**
 * React Hook for JARVIS Client
 *
 * Se comunica con el backend JARVIS vía HTTP y SSE (/api/jarvis/*).
 * Hidrata el estado inicial desde el evento SSE `snapshot`, aplica deltas `change.ops` /
 * `waiting` / `paused` / `created.summary` en tiempo real y usa GET /tasks/:id liviano
 * cuando necesita refrescar una tarea puntual (dejando GET /state solo como respaldo).
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
  StateResponse,
  UserEnvironment,
  EngineLimits,
} from "../types/api.ts";
import { jarvisApi } from "../services/jarvisApi.ts";
import { getApiUrl } from "../utils/apiUrl.ts";
import { applyOpsToSummary, applyTaskOps, summaryFromDto } from "../utils/applyTaskOps.ts";
import { useSpeakNewResults, useSpeech } from "./useSpeech.ts";

export type { ExecutionMode, McpInitStatus } from "../types/ui.ts";

const FALLBACK_POLL_MS = 5000;
const DEBOUNCE_TASK_REFRESH_MS = 80;
const MCP_WARMUP_POLL_MS = 1200;
const MCP_WARMUP_MAX_ATTEMPTS = 6;

const countKeys = (obj?: object | null): number => (obj ? Object.keys(obj).length : 0);

function resolveMcpStatus(
  discoveredTools: Record<string, McpToolDto[]> | undefined | null,
  unavailableServers: UnavailableServers | undefined | null,
  whenEmpty: McpInitStatus
): McpInitStatus {
  const unavailable = countKeys(unavailableServers);
  let serversWithTools = 0;
  let totalTools = 0;
  if (discoveredTools) {
    for (const list of Object.values(discoveredTools)) {
      if (list.length > 0) {
        serversWithTools++;
        totalTools += list.length;
      }
    }
  }
  if (totalTools === 0 && unavailable === 0) return whenEmpty;
  if (unavailable === 0) return "ready";
  return serversWithTools > 0 ? "partial" : "error";
}

function upsertSummary(list: TaskSummary[], summary: TaskSummary): TaskSummary[] {
  const idx = list.findIndex((item) => item.id === summary.id);
  if (idx < 0) return [...list, summary];
  const next = [...list];
  next[idx] = summary;
  return next;
}

export function useJarvis() {
  const activeTaskIdRef = useRef<string | null>(null);
  const taskRef = useRef<TaskDto | null>(null);
  const isInitialSnapshotLoaded = useRef(false);
  const userClearedViewRef = useRef(false);
  const stateReqSeqRef = useRef(0);
  const taskRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (current.kind === "question") {
      return current.question.id;
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
  // Hidratación y refresco liviano por tarea
  // -------------------------------------------------------------------------

  const applyTaskDto = useCallback((fetched: TaskDto, explicit = false) => {
    const currentViewedId = activeTaskIdRef.current;
    const isSameViewedTask = Boolean(currentViewedId && fetched.task.id === currentViewedId);
    const isInitialLoad = !isInitialSnapshotLoaded.current && !userClearedViewRef.current;
    const canAutoShowNew = !currentViewedId && !userClearedViewRef.current;

    if (explicit || isSameViewedTask || isInitialLoad || canAutoShowNew) {
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
  }, []);

  const applySnapshot = useCallback(
    (data: Omit<StateResponse, never>, explicitTaskId?: string) => {
      if (data.tasks) {
        setTasks(data.tasks);
      }

      if (data.task) {
        const explicit = Boolean(explicitTaskId && data.task.task.id === explicitTaskId);
        applyTaskDto(data.task, explicit);
      } else if (!activeTaskIdRef.current) {
        isInitialSnapshotLoaded.current = true;
        setTask(null);
        taskRef.current = null;
      }

      setDiscoveredTools(data.discoveredTools ?? {});
      setUnavailableServers(data.unavailableServers ?? {});
      setMcpInitStatus(resolveMcpStatus(data.discoveredTools, data.unavailableServers, "loading"));
    },
    [applyTaskDto]
  );

  const fetchState = useCallback(
    async (explicitTaskId?: string) => {
      const reqSeq = ++stateReqSeqRef.current;
      try {
        const qTaskId = explicitTaskId || activeTaskIdRef.current || undefined;
        const data = await jarvisApi.getState(qTaskId);
        if (reqSeq !== stateReqSeqRef.current) return;
        applySnapshot(data, explicitTaskId);
      } catch (err) {
        if (reqSeq !== stateReqSeqRef.current) return;
        console.warn("Failed to fetch JARVIS state from backend:", err);
        setMcpInitStatus((prev) => (prev === "loading" ? "error" : prev));
      }
    },
    [applySnapshot]
  );

  const refreshTask = useCallback(
    async (taskId: string, explicit = false) => {
      const reqSeq = ++stateReqSeqRef.current;
      try {
        const fetched = await jarvisApi.getTask(taskId);
        if (reqSeq !== stateReqSeqRef.current) return;
        setTasks((prev) => upsertSummary(prev, summaryFromDto(fetched)));
        applyTaskDto(fetched, explicit);
      } catch (err) {
        if (reqSeq !== stateReqSeqRef.current) return;
        console.warn("Failed to fetch task:", err);
      }
    },
    [applyTaskDto]
  );

  const fetchStateRef = useRef(fetchState);
  const refreshTaskRef = useRef(refreshTask);
  useEffect(() => {
    fetchStateRef.current = fetchState;
    refreshTaskRef.current = refreshTask;
  }, [fetchState, refreshTask]);

  const scheduleTaskRefresh = useCallback((taskId: string) => {
    if (taskRefreshTimerRef.current) {
      clearTimeout(taskRefreshTimerRef.current);
    }
    taskRefreshTimerRef.current = setTimeout(() => {
      void refreshTaskRef.current(taskId);
    }, DEBOUNCE_TASK_REFRESH_MS);
  }, []);

  // Si la página abre antes de que termine el discoverAll() de arranque, consulta caché en /state unas pocas veces sin bloquear.
  useEffect(() => {
    if (mcpInitStatus !== "loading") return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (attempts > MCP_WARMUP_MAX_ATTEMPTS) {
        clearInterval(timer);
        return;
      }
      void fetchStateRef.current();
    }, MCP_WARMUP_POLL_MS);
    return () => clearInterval(timer);
  }, [mcpInitStatus]);

  // -------------------------------------------------------------------------
  // Conexión SSE persistente
  // -------------------------------------------------------------------------

  useEffect(() => {
    void jarvisApi.getEnvironment().then(setEnvironment).catch(() => {});
    void jarvisApi.getLimits().then(setLimits).catch(() => {});
    void jarvisApi
      .getConfig()
      .then((cfg) => {
        setAutoMode(Boolean(cfg.autoMode));
        setVoiceEnabled(Boolean(cfg.voiceEnabled));
      })
      .catch(() => {});

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
        if (hasOpenedOnce && activeTaskIdRef.current) {
          void refreshTaskRef.current(activeTaskIdRef.current);
        }
        hasOpenedOnce = true;
      };

      eventSource.onmessage = (msgEvent) => {
        try {
          if (!msgEvent.data || msgEvent.data.trim().startsWith(":")) {
            return;
          }
          const data = JSON.parse(msgEvent.data) as SseMessage;
          if (!data || typeof data.type !== "string") return;

          if (data.type === "snapshot") {
            stateReqSeqRef.current++;
            applySnapshot(data);
            return;
          }

          if (data.type === "created") {
            setTasks((prev) => upsertSummary(prev, data.summary));
            if (!activeTaskIdRef.current && !userClearedViewRef.current) {
              void refreshTaskRef.current(data.taskId);
            }
            return;
          }

          if (data.type === "change") {
            setTasks((prev) =>
              prev.map((item) => (item.id === data.taskId ? applyOpsToSummary(item, data.n, data.ops) : item))
            );
            const current = taskRef.current;
            if (current && current.task.id === data.taskId) {
              if (data.n === current.n + 1) {
                const next = applyTaskOps(current, data.n, data.ops);
                taskRef.current = next;
                setTask(next);
              } else if (data.n > current.n + 1) {
                scheduleTaskRefresh(data.taskId);
              }
            }
            return;
          }

          if (data.type === "waiting") {
            setTasks((prev) =>
              prev.map((item) =>
                item.id === data.taskId ? { ...item, waiting: data.waiting?.kind ?? null } : item
              )
            );
            const current = taskRef.current;
            if (current && current.task.id === data.taskId) {
              const next = { ...current, waiting: data.waiting };
              taskRef.current = next;
              setTask(next);
            }
            return;
          }

          if (data.type === "paused") {
            const current = taskRef.current;
            if (current && current.task.id === data.taskId) {
              const next = { ...current, paused: data.paused };
              taskRef.current = next;
              setTask(next);
            }
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
      void fetchStateRef.current();
    }

    return () => {
      if (taskRefreshTimerRef.current) clearTimeout(taskRefreshTimerRef.current);
      eventSource?.close();
      stopFallbackPolling();
    };
  }, [applySnapshot, scheduleTaskRefresh]);

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
        setTasks((prev) => upsertSummary(prev, summaryFromDto(data.task)));
      }, "Error al iniciar la tarea.");
    },
    [mode, runAccepted]
  );

  const cancelTask = useCallback(
    async (explicitTaskId?: string): Promise<boolean> => {
      const res = await runAction(async () => {
        const targetId = resolveTaskId(explicitTaskId);
        const result = await jarvisApi.cancelTask(targetId);
        if (targetId) await refreshTask(targetId);
        return result;
      }, "Error al cancelar la tarea.");
      return Boolean(res);
    },
    [runAction, resolveTaskId, refreshTask]
  );

  const confirmPlan = useCallback(
    (): Promise<boolean> =>
      runAccepted(async () => {
        const targetId = resolveTaskId();
        await jarvisApi.confirmPlan(targetId, resolveWaitId());
        if (targetId) await refreshTask(targetId);
      }, "Error al confirmar el plan."),
    [runAccepted, resolveTaskId, resolveWaitId, refreshTask]
  );

  const rejectPlan = useCallback(
    (): Promise<boolean> =>
      runAccepted(async () => {
        const targetId = resolveTaskId();
        await jarvisApi.rejectPlan(targetId, resolveWaitId());
        if (targetId) await refreshTask(targetId);
      }, "Error al rechazar el plan."),
    [runAccepted, resolveTaskId, resolveWaitId, refreshTask]
  );

  const modifyPlan = useCallback(
    (feedback: string): Promise<boolean> =>
      runAccepted(async () => {
        const targetId = resolveTaskId();
        await jarvisApi.modifyPlan(feedback, targetId, resolveWaitId());
        if (targetId) await refreshTask(targetId);
      }, "Error al solicitar modificación del plan."),
    [runAccepted, resolveTaskId, resolveWaitId, refreshTask]
  );

  const provideUserAnswer = useCallback(
    (answer: string): Promise<boolean> =>
      runAccepted(async () => {
        const targetId = resolveTaskId();
        await jarvisApi.provideUserAnswer(answer, targetId, resolveWaitId());
        if (targetId) await refreshTask(targetId);
      }, "Error al enviar respuesta interactiva."),
    [runAccepted, resolveTaskId, resolveWaitId, refreshTask]
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
        if (targetId) await refreshTask(targetId);
      }, "Error al aprobar la operación pendiente."),
    [runAccepted, resolveTaskId, resolveWaitId, refreshTask]
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
        if (targetId) await refreshTask(targetId);
      }, "Error al denegar la operación pendiente."),
    [runAccepted, resolveTaskId, resolveWaitId, refreshTask]
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
    setMcpInitStatus(resolveMcpStatus(data.tools, data.unavailableServers, "error"));
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

  const toggleAutoMode = useCallback(
    async (forced?: boolean) => {
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
    },
    [autoMode]
  );

  const clearTaskView = useCallback(() => {
    stateReqSeqRef.current++;
    if (taskRefreshTimerRef.current) {
      clearTimeout(taskRefreshTimerRef.current);
      taskRefreshTimerRef.current = null;
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
        const fetched = await jarvisApi.getTask(taskId);
        if (reqSeq !== stateReqSeqRef.current) return;
        setTasks((prev) => upsertSummary(prev, summaryFromDto(fetched)));
        applyTaskDto(fetched, true);
        setError(null);
      } catch (e) {
        if (reqSeq !== stateReqSeqRef.current) return;
        console.warn("Failed to retrieve historical task:", e);
        setError(
          e instanceof Error && e.message
            ? e.message
            : "La tarea seleccionada ya no está disponible en el servidor."
        );
      }
    },
    [applyTaskDto]
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
