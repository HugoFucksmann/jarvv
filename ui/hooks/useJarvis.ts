/**
 * React Hook for JARVIS Client
 *
 * Communicates exclusively with the authoritative Node.js JARVIS backend via HTTP / SSE.
 * Does NOT instantiate or bundle JarvisCore, DiscoveryEngine, Decision20Engine,
 * QwenEngine, child_process, or any MCP transport inside the browser.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { Task, PendingApproval, CoreEvent, MCPTool } from "../../src/core/types.ts";
import type { ModelIteration } from "../types/debug.ts";
import { jarvisApi, type SerializedPendingApproval } from "../services/jarvisApi.ts";
import { getApiUrl } from "../utils/apiUrl.ts";
import { createIterationFromEvent, reconstructIterationsFromTask } from "../utils/debugAccumulator.ts";

export type ExecutionMode = "NORMAL" | "PLAN";
export type McpInitStatus = "loading" | "ready" | "partial" | "error";
type UnavailableServers = Record<string, { reason: string; since: number }>;

const MAX_EVENTS = 500;
const FALLBACK_POLL_MS = 5000;

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

function upsertById(list: Task[], task: Task): Task[] {
  const idx = list.findIndex((t) => t.id === task.id);
  if (idx < 0) return [...list, task];
  const next = [...list];
  next[idx] = task;
  return next;
}

const countKeys = (obj?: object | null): number => (obj ? Object.keys(obj).length : 0);

/** `whenEmpty` define qué significa "sin herramientas y sin errores": arranque (loading) o refresco fallido (error). */
function resolveMcpStatus(discovered: number, unavailable: number, whenEmpty: McpInitStatus): McpInitStatus {
  if (discovered === 0 && unavailable === 0) return whenEmpty;
  if (unavailable === 0) return "ready";
  return discovered > 0 ? "partial" : "error";
}

function isAwaitingUserAnswer(t: Task | null | undefined): boolean {
  return t?.state === "WAITING_INPUT" && t.waitingReason === "user_answer";
}

function extractUserQuestion(t: Task | null): string | null {
  if (!t || !isAwaitingUserAnswer(t)) return null;
  // La pregunta persistida por el núcleo es la fuente de verdad; lo siguiente solo cubre tareas antiguas.
  if (t.pendingQuestion?.question) return t.pendingQuestion.question;
  for (let i = t.steps.length - 1; i >= 0; i--) {
    const s = t.steps[i];
    if (s.calls) {
      for (let j = s.calls.length - 1; j >= 0; j--) {
        const c = s.calls[j];
        if (c.tool === "ask_user" && c.args) {
          const q = (c.args.question as string) || (c.args.prompt as string);
          if (q) return q;
        }
      }
    }
    if (s.tool === "ask_user" && s.args) {
      const q = (s.args.question as string) || (s.args.prompt as string);
      if (q) return q;
    }
    if (s.error && (s.state === "UNVERIFIED" || s.state === "RUNNING")) {
      return s.error;
    }
  }
  return null;
}

/** Iteraciones de una tarea: las persistidas en ella, si no las ya conocidas, si no se reconstruyen del snapshot. */
function resolveIterations(task: Task, known: ModelIteration[] | undefined): ModelIteration[] {
  if (task.modelIterations && task.modelIterations.length > 0) return task.modelIterations;
  if (known && known.length > 0) return known;
  return reconstructIterationsFromTask(task);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useJarvis() {
  const activeTaskIdRef = useRef<string | null>(null);
  const taskRef = useRef<Task | null>(null);
  const allTasksRef = useRef<Task[]>([]);
  const eventsByTaskRef = useRef<Record<string, CoreEvent[]>>({});
  const iterationsByTaskRef = useRef<Record<string, ModelIteration[]>>({});
  const isInitialSnapshotLoaded = useRef(false);
  const userClearedViewRef = useRef(false);
  const mcpInitDoneRef = useRef(false);

  const [task, setTask] = useState<Task | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [events, setEvents] = useState<CoreEvent[]>([]);
  const [modelIterations, setModelIterations] = useState<ModelIteration[]>([]);
  const [discoveredTools, setDiscoveredTools] = useState<Record<string, MCPTool[]>>({});
  const [unavailableServers, setUnavailableServers] = useState<UnavailableServers>({});
  const [mode, setMode] = useState<ExecutionMode>("NORMAL");
  const [error, setError] = useState<string | null>(null);
  const [userQuestion, setUserQuestion] = useState<string | null>(null);
  const [mcpInitStatus, setMcpInitStatus] = useState<McpInitStatus>("loading");

  // Refs sincronizadas con el estado para que los callbacks (EventSource, etc.) no dependan de él (FRONT-02)
  useEffect(() => {
    allTasksRef.current = allTasks;
  }, [allTasks]);

  useEffect(() => {
    taskRef.current = task;
    if (task?.id) {
      activeTaskIdRef.current = task.id;
    }
  }, [task]);

  // -------------------------------------------------------------------------
  // Utilidades internas (todas estables: solo tocan refs y setters)
  // -------------------------------------------------------------------------

  /** taskId explícito válido, o el de la tarea activa. Nunca envía null. */
  const resolveTaskId = useCallback(
    (explicit?: string): string | undefined =>
      explicit?.trim() ? explicit : activeTaskIdRef.current || taskRef.current?.id || undefined,
    []
  );

  /** Ejecuta una acción contra el backend limpiando y reportando el error de forma uniforme. */
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

  const upsertTask = useCallback((t: Task) => {
    setAllTasks((prev) => {
      const next = upsertById(prev, t);
      allTasksRef.current = next;
      return next;
    });
  }, []);

  /** Muestra una tarea como la activa de la vista. */
  const showTask = useCallback((t: Task) => {
    activeTaskIdRef.current = t.id;
    taskRef.current = t;
    setTask({ ...t });
  }, []);

  const commitIterations = useCallback((taskId: string, iterations: ModelIteration[]) => {
    iterationsByTaskRef.current[taskId] = iterations;
    setModelIterations(iterations);
  }, []);

  const syncUserQuestion = useCallback((t: Task) => {
    setUserQuestion((prev) => (isAwaitingUserAnswer(t) ? prev || extractUserQuestion(t) : null));
  }, []);

  // -------------------------------------------------------------------------
  // Aprobaciones Guard
  // -------------------------------------------------------------------------

  const approvePending = useCallback(
    async (explicitTaskId?: string) => {
      await runAction(async () => {
        await jarvisApi.approvePending(resolveTaskId(explicitTaskId));
        setPendingApproval(null);
      }, "Error al aprobar la operación pendiente.");
    },
    [runAction, resolveTaskId]
  );

  const denyPending = useCallback(
    async (reason?: string, explicitTaskId?: string) => {
      await runAction(async () => {
        await jarvisApi.denyPending(resolveTaskId(explicitTaskId), reason);
        setPendingApproval(null);
      }, "Error al denegar la operación pendiente.");
    },
    [runAction, resolveTaskId]
  );

  /** Convierte el pendiente serializado del backend en el objeto que usa la UI, con sus callbacks ya vinculados. */
  const hydratePendingApproval = useCallback(
    (raw: SerializedPendingApproval | null | undefined, fallbackTaskId?: string): PendingApproval | null => {
      if (!raw) return null;
      const associatedTaskId = raw.taskId || fallbackTaskId || activeTaskIdRef.current || taskRef.current?.id;
      return {
        id: raw.id,
        stepId: raw.stepId,
        mcp: raw.mcp,
        tool: raw.tool,
        capability: raw.capability,
        args: raw.args || {},
        reason: raw.reason || "",
        // Se devuelve la promesa para que la UI mantenga el botón bloqueado hasta que el backend responda.
        onApprove: () => approvePending(associatedTaskId),
        onDeny: (denyReason?: string) => denyPending(denyReason, associatedTaskId),
      };
    },
    [approvePending, denyPending]
  );

  const hydratePendingApprovalRef = useRef(hydratePendingApproval);
  useEffect(() => {
    hydratePendingApprovalRef.current = hydratePendingApproval;
  }, [hydratePendingApproval]);

  // -------------------------------------------------------------------------
  // Snapshot de estado
  // -------------------------------------------------------------------------

  const fetchState = useCallback(async () => {
    try {
      const data = await jarvisApi.getState(activeTaskIdRef.current || undefined);

      if (data.allTasks) {
        setAllTasks(data.allTasks);
        allTasksRef.current = data.allTasks;
      }

      if (data.task) {
        const fetched = data.task;
        const iterations = resolveIterations(fetched, iterationsByTaskRef.current[fetched.id]);
        iterationsByTaskRef.current[fetched.id] = iterations;

        // No se pisa la vista si el usuario la limpió, salvo que haya una tarea corriendo
        const shouldShow =
          !isInitialSnapshotLoaded.current || !userClearedViewRef.current || fetched.state === "RUNNING";
        if (shouldShow) {
          isInitialSnapshotLoaded.current = true;
          showTask(fetched);
          setModelIterations(iterations);
        }
        syncUserQuestion(fetched);
      }

      setPendingApproval(hydratePendingApproval(data.pendingApproval, data.task?.id));

      if (countKeys(data.discoveredTools) > 0) {
        setDiscoveredTools(data.discoveredTools);
      }
      if (data.unavailableServers) {
        setUnavailableServers(data.unavailableServers);
      }

      // El estado de inicialización de MCP se resuelve con el primer snapshot exitoso
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
  }, [hydratePendingApproval, showTask, syncUserQuestion]);

  const fetchStateRef = useRef(fetchState);
  useEffect(() => {
    fetchStateRef.current = fetchState;
  }, [fetchState]);

  // -------------------------------------------------------------------------
  // Eventos en tiempo real (SSE)
  // -------------------------------------------------------------------------

  /** Registra el evento en el buffer de su tarea y captura la iteración de modelo (Eos / Qwen) que genere. */
  const recordEvent = useCallback((event: CoreEvent, updatedTask?: Task | null) => {
    const isActive = !activeTaskIdRef.current || event.taskId === activeTaskIdRef.current;

    // Buffer circular de MAX_EVENTS eventos, indexado por taskId
    const taskEvents = eventsByTaskRef.current[event.taskId] || [];
    eventsByTaskRef.current[event.taskId] = [...taskEvents.slice(-(MAX_EVENTS - 1)), event];
    if (isActive) {
      setEvents((prev) => [...prev.slice(-(MAX_EVENTS - 1)), event]);
    }

    // Pregunta interactiva que requiere respuesta del usuario (FRONT-03)
    if (event.type === "TASK_STATE_CHANGED") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const evtData = (event.data || {}) as Record<string, any>;
      if (evtData.state === "WAITING_INPUT" && evtData.waitingReason === "user_answer") {
        setUserQuestion(evtData.question || null);
      } else if (evtData.state && evtData.state !== "WAITING_INPUT") {
        setUserQuestion(null);
      }
    }

    const contextTask = updatedTask || (event.taskId === taskRef.current?.id ? taskRef.current : null);
    const iteration = createIterationFromEvent(event, contextTask);
    if (!iteration) return;

    const known = iterationsByTaskRef.current[event.taskId] || [];
    if (known.some((it) => it.id === iteration.id)) return;

    const next = [...known, iteration];
    iterationsByTaskRef.current[event.taskId] = next;
    if (isActive) {
      setModelIterations(next);
    }
  }, []);

  /** Aplica la tarea actualizada que acompaña a cada mensaje SSE. */
  const applyTaskUpdate = useCallback(
    (updatedTask: Task) => {
      taskRef.current = updatedTask;
      upsertTask(updatedTask);
      syncUserQuestion(updatedTask);

      // Evita que el SSE restaure una tarea si el usuario limpió la vista
      const matchesActive = Boolean(activeTaskIdRef.current && updatedTask.id === activeTaskIdRef.current);
      const isFreshRunningTask =
        !activeTaskIdRef.current && !userClearedViewRef.current && updatedTask.state === "RUNNING";
      if (!matchesActive && !isFreshRunningTask) return;

      userClearedViewRef.current = false;
      showTask(updatedTask);
      commitIterations(updatedTask.id, resolveIterations(updatedTask, iterationsByTaskRef.current[updatedTask.id]));
    },
    [upsertTask, syncUserQuestion, showTask, commitIterations]
  );

  // Montaje único y conexión persistente: todas las dependencias son estables (FRONT-02)
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

      eventSource.onmessage = (messageEvent) => {
        try {
          const { event, task: updatedTask, pendingApproval: rawPending } = JSON.parse(messageEvent.data);

          if (event) recordEvent(event, updatedTask);
          if (updatedTask) applyTaskUpdate(updatedTask);
          if (rawPending !== undefined) {
            setPendingApproval(hydratePendingApprovalRef.current(rawPending, updatedTask?.id));
          }
        } catch (e) {
          console.error("Failed to parse JARVIS SSE message:", e);
        }
      };

      eventSource.onerror = () => {
        startFallbackPolling();
        void fetchStateRef.current();
      };
    } catch (err) {
      console.warn("EventSource not supported or failed to connect:", err);
      startFallbackPolling();
    }

    return () => {
      eventSource?.close();
      stopFallbackPolling();
    };
  }, [recordEvent, applyTaskUpdate]);

  // -------------------------------------------------------------------------
  // Acciones
  // -------------------------------------------------------------------------

  const runTask = useCallback(
    async (message: string, executionMode?: ExecutionMode) => {
      if (!message.trim()) return;
      userClearedViewRef.current = false;
      setEvents([]);
      setModelIterations([]);

      const effectiveMode = executionMode || mode;
      if (executionMode && executionMode !== mode) {
        setMode(executionMode);
      }

      await runAction(async () => {
        const data = await jarvisApi.initiateTask(message, effectiveMode);
        if (data.task) {
          showTask(data.task);
          setPendingApproval(null);
          upsertTask(data.task); // Sincroniza allTasks al instante (FRONT-01)
        }
      }, "Error al iniciar la tarea.");
    },
    [mode, runAction, showTask, upsertTask]
  );

  const cancelTask = useCallback(
    async (explicitTaskId?: string): Promise<boolean> => {
      const res = await runAction(async () => {
        const result = await jarvisApi.cancelTask(resolveTaskId(explicitTaskId));
        await fetchState();
        return result;
      }, "Error al cancelar la tarea.");
      return Boolean(res?.ok);
    },
    [runAction, resolveTaskId, fetchState]
  );

  const confirmPlan = useCallback(async () => {
    await runAction(async () => {
      await jarvisApi.confirmPlan(resolveTaskId());
      await fetchState();
    }, "Error al confirmar el plan.");
  }, [runAction, resolveTaskId, fetchState]);

  const rejectPlan = useCallback(
    async (reason?: string) => {
      await runAction(async () => {
        await jarvisApi.rejectPlan(resolveTaskId(), reason);
        await fetchState();
      }, "Error al rechazar el plan.");
    },
    [runAction, resolveTaskId, fetchState]
  );

  const modifyPlan = useCallback(
    async (feedback?: string) => {
      await runAction(async () => {
        await jarvisApi.modifyPlan(resolveTaskId(), feedback);
        await fetchState();
      }, "Error al solicitar modificación del plan.");
    },
    [runAction, resolveTaskId, fetchState]
  );

  const provideUserAnswer = useCallback(
    async (answer: string) => {
      await runAction(async () => {
        setUserQuestion(null);
        await jarvisApi.provideUserAnswer(resolveTaskId(), answer);
        await fetchState();
      }, "Error al enviar respuesta interactiva.");
    },
    [runAction, resolveTaskId, fetchState]
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
    if (data.tools) setDiscoveredTools(data.tools);
    if (data.unavailableServers) setUnavailableServers(data.unavailableServers);
    setMcpInitStatus(resolveMcpStatus(countKeys(data.tools), countKeys(data.unavailableServers), "error"));
  }, [runAction]);

  /** Limpia la vista local para iniciar una nueva consulta sin alterar el historial del backend. */
  const clearTaskView = useCallback(() => {
    userClearedViewRef.current = true;
    activeTaskIdRef.current = null;
    taskRef.current = null;
    setTask(null);
    setEvents([]);
    setModelIterations([]);
    setPendingApproval(null);
    setUserQuestion(null);
    setError(null);
  }, []);

  /** Selecciona una tarea previa del historial para visualización de solo lectura. */
  const selectHistoricalTask = useCallback(
    async (taskId: string) => {
      let found = allTasksRef.current.find((t) => t.id === taskId);

      // Los listados y el SSE no transportan `modelIterations`: si no hay traza conocida, se pide la tarea completa.
      const hasKnownTrace =
        Boolean(found?.modelIterations?.length) || Boolean(iterationsByTaskRef.current[taskId]?.length);
      if (!found || !hasKnownTrace) {
        try {
          const data = await jarvisApi.getState(taskId);
          if (data.task && data.task.id === taskId) {
            found = data.task;
            upsertTask(data.task);
          }
        } catch (e) {
          console.warn("Failed to retrieve historical task:", e);
        }
      }

      if (!found) return;

      userClearedViewRef.current = false;
      showTask(found);
      setPendingApproval(null);
      setError(null);
      setUserQuestion(extractUserQuestion(found));
      setEvents(eventsByTaskRef.current[found.id] || []);
      commitIterations(found.id, resolveIterations(found, iterationsByTaskRef.current[found.id]));
    },
    [upsertTask, showTask, commitIterations]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    task,
    allTasks,
    mode,
    setMode,
    pendingApproval,
    userQuestion,
    events,
    modelIterations,
    discoveredTools,
    unavailableServers,
    mcpInitStatus,
    error,
    clearError,
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