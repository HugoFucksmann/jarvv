/**
 * React Hook for JARVIS Client
 *
 * Communicates exclusively with the authoritative Node.js JARVIS backend via HTTP / SSE.
 * Does NOT instantiate or bundle JarvisCore, DiscoveryEngine, Decision20Engine,
 * QwenEngine, child_process, or any MCP transport inside the browser.
 *
 * El back es la fuente de verdad: la pregunta interactiva sale de `task.pendingQuestion`, las iteraciones de
 * `task.modelIterations` (en `/state`) o de los eventos SSE (`createIterationFromEvent`, módulo del core).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Task, Step, PendingApproval, CoreEvent, MCPTool } from "../../src/core/types.ts";
import type { ModelIteration } from "../types/debug.ts";
import type { ExecutionMode, McpInitStatus } from "../types/ui.ts";
import type { SerializedPendingApproval, SseMessage, UnavailableServers, WireTask } from "../types/api.ts";
import { jarvisApi } from "../services/jarvisApi.ts";
import { getApiUrl } from "../utils/apiUrl.ts";
import { createIterationFromEvent } from "../utils/debugAccumulator.ts";

export type { ExecutionMode, McpInitStatus } from "../types/ui.ts";

const MAX_EVENTS = 500;
/** Tope de iteraciones de modelo por tarea (cada una guarda el texto crudo de entrada y salida). */
const MAX_ITERATIONS = 300;
/** Tareas cuyos eventos e iteraciones se conservan en memoria: las más antiguas se descartan (se recuperan con `/state`). */
const MAX_BUFFERED_TASKS = 20;
const FALLBACK_POLL_MS = 5000;

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

/** Dos pasos son el mismo dato: se compara lo barato primero y la serialización solo si todo coincide. */
function sameStep(a: Step, b: Step): boolean {
  return (
    a.id === b.id &&
    a.state === b.state &&
    a.rev === b.rev &&
    a.superseded === b.superseded &&
    a.verification === b.verification &&
    (a.calls?.length ?? 0) === (b.calls?.length ?? 0) &&
    JSON.stringify(a) === JSON.stringify(b)
  );
}

/**
 * Cada mensaje SSE trae la tarea entera como objetos nuevos. Se reutilizan los pasos que no cambiaron para que
 * `React.memo` pueda saltarse sus renders: en cada evento normalmente cambia un solo paso.
 */
function reuseSteps(prev: Task | null, next: WireTask): WireTask {
  if (!prev || prev.id !== next.id) return next;
  let allSame = prev.steps.length === next.steps.length;
  const steps = next.steps.map((s, i) => {
    const old = prev.steps[i];
    if (old && sameStep(old, s)) return old;
    allSame = false;
    return s;
  });
  return { ...next, steps: allSame ? prev.steps : steps };
}

/** Descarta los buffers de las tareas más antiguas para que la memoria no crezca con la cantidad de tareas de la sesión. */
function pruneBuffers(
  events: Record<string, CoreEvent[]>,
  iterations: Record<string, ModelIteration[]>,
  keepId: string
): void {
  const ids = Object.keys(events);
  for (let i = 0; ids.length - i > MAX_BUFFERED_TASKS; i++) {
    if (ids[i] === keepId) continue;
    delete events[ids[i]];
    delete iterations[ids[i]];
  }
}

function upsertById(list: WireTask[], task: WireTask): WireTask[] {
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

/** La pregunta abierta la persiste el núcleo en `pendingQuestion`; no se infiere de los pasos ni de los eventos. */
function userQuestionOf(t: WireTask | null | undefined): string | null {
  return t?.state === "WAITING_INPUT" && t.waitingReason === "user_answer"
    ? t.pendingQuestion?.question ?? null
    : null;
}

/** Iteraciones de una tarea completa (`/state`): las que trae el back; si no, las ya acumuladas por SSE. */
function resolveIterations(task: Task, known: ModelIteration[] | undefined): ModelIteration[] {
  return task.modelIterations && task.modelIterations.length > 0 ? task.modelIterations : known ?? [];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useJarvis() {
  const activeTaskIdRef = useRef<string | null>(null);
  const taskRef = useRef<Task | null>(null);
  const allTasksRef = useRef<WireTask[]>([]);
  const eventsByTaskRef = useRef<Record<string, CoreEvent[]>>({});
  const iterationsByTaskRef = useRef<Record<string, ModelIteration[]>>({});
  const isInitialSnapshotLoaded = useRef(false);
  const userClearedViewRef = useRef(false);
  const mcpInitDoneRef = useRef(false);

  const [task, setTask] = useState<Task | null>(null);
  const [allTasks, setAllTasks] = useState<WireTask[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [events, setEvents] = useState<CoreEvent[]>([]);
  const [modelIterations, setModelIterations] = useState<ModelIteration[]>([]);
  const [discoveredTools, setDiscoveredTools] = useState<Record<string, MCPTool[]>>({});
  const [unavailableServers, setUnavailableServers] = useState<UnavailableServers>({});
  const [mode, setMode] = useState<ExecutionMode>("NORMAL");
  const [error, setError] = useState<string | null>(null);
  const [mcpInitStatus, setMcpInitStatus] = useState<McpInitStatus>("loading");

  // Derivada de la tarea: el back la mantiene en `pendingQuestion`, así que no hay estado propio que sincronizar.
  const userQuestion = useMemo(() => userQuestionOf(task), [task]);

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

  /** Como `runAction` para acciones sin resultado: informa si el back la aceptó, para que el formulario sepa si cerrarse. */
  const runAccepted = useCallback(
    async (action: () => Promise<unknown>, fallbackMessage: string): Promise<boolean> =>
      (await runAction(async () => {
        await action();
        return true;
      }, fallbackMessage)) === true,
    [runAction]
  );

  const upsertTask = useCallback((t: WireTask) => {
    setAllTasks((prev) => {
      const next = upsertById(prev, t);
      allTasksRef.current = next;
      return next;
    });
  }, []);

  /** Muestra una tarea como la activa de la vista. */
  const showTask = useCallback((t: WireTask) => {
    const shared = reuseSteps(taskRef.current, t);
    activeTaskIdRef.current = shared.id;
    taskRef.current = shared;
    setTask(shared);
  }, []);

  const commitIterations = useCallback((taskId: string, iterations: ModelIteration[]) => {
    iterationsByTaskRef.current[taskId] = iterations;
    setModelIterations(iterations);
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

  /**
   * Convierte el pendiente serializado del backend en el objeto que usa la UI, con sus callbacks ya vinculados.
   * El back no envía el taskId dentro del pendiente: lo aporta quien conoce la tarea (evento o snapshot).
   */
  const hydratePendingApproval = useCallback(
    (raw: SerializedPendingApproval | null | undefined, taskId?: string): PendingApproval | null => {
      if (!raw) return null;
      const associatedTaskId = taskId || activeTaskIdRef.current || taskRef.current?.id;
      return {
        ...raw,
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

  /** Aplica el pendiente de una tarea; si es la misma aprobación que ya se muestra, conserva el objeto (sin re-render). */
  const applyPending = useCallback((raw: SerializedPendingApproval | null | undefined, taskId?: string) => {
    setPendingApproval((prev) =>
      !raw ? null : prev?.id === raw.id ? prev : hydratePendingApprovalRef.current(raw, taskId)
    );
  }, []);

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
      }

      applyPending(data.pendingApproval, data.task?.id);

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
  }, [applyPending, showTask]);

  const fetchStateRef = useRef(fetchState);
  useEffect(() => {
    fetchStateRef.current = fetchState;
  }, [fetchState]);

  // -------------------------------------------------------------------------
  // Eventos en tiempo real (SSE)
  // -------------------------------------------------------------------------

  /** Registra el evento en el buffer de su tarea y captura la iteración de modelo (Eos / Qwen) que genere. */
  const recordEvent = useCallback((event: CoreEvent, updatedTask?: WireTask | null) => {
    const isActive = !activeTaskIdRef.current || event.taskId === activeTaskIdRef.current;

    // Buffer circular de MAX_EVENTS eventos por taskId. Un único arreglo nuevo por evento: el buffer y el estado lo comparten (nunca se muta).
    const buffers = eventsByTaskRef.current;
    const nextEvents = [...(buffers[event.taskId] ?? []).slice(-(MAX_EVENTS - 1)), event];
    buffers[event.taskId] = nextEvents;
    pruneBuffers(buffers, iterationsByTaskRef.current, event.taskId);
    if (isActive) {
      setEvents(nextEvents);
    }

    const contextTask = updatedTask || (event.taskId === taskRef.current?.id ? taskRef.current : null);
    const iteration = createIterationFromEvent(event, contextTask);
    if (!iteration) return;

    const known = iterationsByTaskRef.current[event.taskId] || [];
    if (known.some((it) => it.id === iteration.id)) return;

    const next = [...known.slice(-(MAX_ITERATIONS - 1)), iteration];
    iterationsByTaskRef.current[event.taskId] = next;
    if (isActive) {
      setModelIterations(next);
    }
  }, []);

  /** Aplica la tarea actualizada que acompaña a cada mensaje SSE (sin `modelIterations`: se acumulan por evento). */
  const applyTaskUpdate = useCallback(
    (updatedTask: WireTask) => {
      upsertTask(updatedTask);

      // Evita que el SSE restaure una tarea si el usuario limpió la vista
      const matchesActive = Boolean(activeTaskIdRef.current && updatedTask.id === activeTaskIdRef.current);
      const isFreshRunningTask =
        !activeTaskIdRef.current && !userClearedViewRef.current && updatedTask.state === "RUNNING";
      if (!matchesActive && !isFreshRunningTask) return;

      userClearedViewRef.current = false;
      showTask(updatedTask);
      commitIterations(updatedTask.id, iterationsByTaskRef.current[updatedTask.id] ?? []);
    },
    [upsertTask, showTask, commitIterations]
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
          const { event, task: updatedTask, pendingApproval: rawPending } = JSON.parse(messageEvent.data) as SseMessage;

          recordEvent(event, updatedTask);
          if (updatedTask) applyTaskUpdate(updatedTask);

          // El pendiente de cada mensaje es el de SU tarea: solo se aplica si es la que se está viendo.
          if (event.taskId === activeTaskIdRef.current) {
            applyPending(rawPending, event.taskId);
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
  }, [recordEvent, applyTaskUpdate, applyPending]);

  // -------------------------------------------------------------------------
  // Acciones
  // -------------------------------------------------------------------------

  /** Devuelve si el back aceptó la tarea: la entrada de texto devuelve lo escrito al usuario si no. */
  const runTask = useCallback(
    async (message: string, executionMode?: ExecutionMode): Promise<boolean> => {
      if (!message.trim()) return false;

      const effectiveMode = executionMode || mode;
      if (executionMode && executionMode !== mode) {
        setMode(executionMode);
      }

      // La vista actual solo se reemplaza cuando el back acepta la tarea: un rechazo no deja la pantalla vacía.
      return runAccepted(async () => {
        const data = await jarvisApi.initiateTask(message, effectiveMode);
        userClearedViewRef.current = false;
        showTask(data.task);
        setPendingApproval(null);
        upsertTask(data.task); // Sincroniza allTasks al instante (FRONT-01)
        // Lo que ya llegó por SSE de esta tarea antes de la respuesta HTTP queda en los buffers: se muestra desde ahí.
        setEvents(eventsByTaskRef.current[data.task.id] ?? []);
        setModelIterations(iterationsByTaskRef.current[data.task.id] ?? []);
      }, "Error al iniciar la tarea.");
    },
    [mode, runAccepted, showTask, upsertTask]
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

  // Las acciones sobre el plan y la pregunta devuelven si el back las aceptó: el formulario solo se cierra si fue así.
  const confirmPlan = useCallback(
    (): Promise<boolean> =>
      runAccepted(async () => {
        await jarvisApi.confirmPlan(resolveTaskId());
        await fetchState();
      }, "Error al confirmar el plan."),
    [runAccepted, resolveTaskId, fetchState]
  );

  const rejectPlan = useCallback(
    (reason?: string): Promise<boolean> =>
      runAccepted(async () => {
        await jarvisApi.rejectPlan(resolveTaskId(), reason);
        await fetchState();
      }, "Error al rechazar el plan."),
    [runAccepted, resolveTaskId, fetchState]
  );

  const modifyPlan = useCallback(
    (feedback?: string): Promise<boolean> =>
      runAccepted(async () => {
        await jarvisApi.modifyPlan(resolveTaskId(), feedback);
        await fetchState();
      }, "Error al solicitar modificación del plan."),
    [runAccepted, resolveTaskId, fetchState]
  );

  /** La pregunta no se limpia aquí: desaparece cuando el back acepta la respuesta y cambia el estado de la tarea. */
  const provideUserAnswer = useCallback(
    (answer: string): Promise<boolean> =>
      runAccepted(async () => {
        await jarvisApi.provideUserAnswer(resolveTaskId(), answer);
        await fetchState();
      }, "Error al enviar respuesta interactiva."),
    [runAccepted, resolveTaskId, fetchState]
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

  /** Limpia la vista local para iniciar una nueva consulta sin alterar el historial del backend. */
  const clearTaskView = useCallback(() => {
    userClearedViewRef.current = true;
    activeTaskIdRef.current = null;
    taskRef.current = null;
    setTask(null);
    setEvents([]);
    setModelIterations([]);
    setPendingApproval(null);
    setError(null);
  }, []);

  /** Selecciona una tarea del historial. El listado no trae la traza: la tarea completa se pide siempre al back. */
  const selectHistoricalTask = useCallback(
    async (taskId: string) => {
      let fetched: Task | undefined;
      let rawPending: SerializedPendingApproval | null = null;

      try {
        const data = await jarvisApi.getState(taskId);
        if (data.task?.id === taskId) {
          fetched = data.task;
          rawPending = data.pendingApproval;
          upsertTask(data.task);
        }
      } catch (e) {
        console.warn("Failed to retrieve historical task:", e);
      }

      const found: WireTask | undefined = fetched ?? allTasksRef.current.find((t) => t.id === taskId);
      if (!found) return;

      userClearedViewRef.current = false;
      showTask(found);
      applyPending(rawPending, taskId);
      setError(null);
      setEvents(eventsByTaskRef.current[found.id] || []);
      commitIterations(
        found.id,
        fetched
          ? resolveIterations(fetched, iterationsByTaskRef.current[found.id])
          : iterationsByTaskRef.current[found.id] ?? []
      );
    },
    [upsertTask, showTask, commitIterations, applyPending]
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