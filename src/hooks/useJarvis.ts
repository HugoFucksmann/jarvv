/**
 * React Hook for JARVIS Client
 * 
 * Communicates exclusively with the authoritative Node.js JARVIS backend via HTTP / SSE.
 * Does NOT instantiate or bundle JarvisCore, DiscoveryEngine, Decision20Engine,
 * QwenEngine, child_process, or any MCP transport inside the browser.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Task, PendingApproval, CoreEvent, MCPTool } from "../core/types.ts";
import type { MCPPrompt, MCPResourceTemplate } from "../core/mcp/types.ts";
import type { ModelIteration } from "../types/debug.ts";
import { jarvisApi } from "../services/jarvisApi.ts";
import { getApiUrl } from "../utils/apiUrl.ts";
import { createIterationFromEvent, deriveTaskView, reconstructIterationsFromTask } from "../utils/debugAccumulator.ts";

export function useJarvis() {
  const activeTaskIdRef = useRef<string | null>(null);
  const taskRef = useRef<Task | null>(null);
  const eventsByTaskRef = useRef<Record<string, CoreEvent[]>>({});
  const iterationsByTaskRef = useRef<Record<string, ModelIteration[]>>({});
  const isInitialSnapshotLoaded = useRef<boolean>(false);
  const userClearedViewRef = useRef<boolean>(false);

  const [task, setTask] = useState<Task | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [events, setEvents] = useState<CoreEvent[]>([]);
  const [modelIterations, setModelIterations] = useState<ModelIteration[]>([]);
  const [discoveredTools, setDiscoveredTools] = useState<Record<string, MCPTool[]>>({});
  const [extraCapabilities, setExtraCapabilities] = useState<{
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  }>({ prompts: {}, resourceTemplates: {} });
  const [unavailableServers, setUnavailableServers] = useState<Record<string, { reason: string; since: number }>>({});
  const [mode, setMode] = useState<"NORMAL" | "PLAN">("NORMAL");
  const [error, setError] = useState<string | null>(null);
  const [userQuestion, setUserQuestion] = useState<string | null>(null);
  const [mcpInitStatus, setMcpInitStatus] = useState<"loading" | "ready" | "partial" | "error">("loading");
  const mcpInitDoneRef = useRef<boolean>(false);

  // Refs para estabilizar callbacks dentro de EventSource y evitar reconexiones cíclicas (FRONT-02)
  const allTasksRef = useRef<Task[]>([]);
  useEffect(() => {
    allTasksRef.current = allTasks;
  }, [allTasks]);

  // Sincronizar referencia síncrona del task actual
  useEffect(() => {
    taskRef.current = task;
    if (task?.id) {
      activeTaskIdRef.current = task.id;
    }
  }, [task]);

  // Approve action (resolves taskId safely without sending null)
  const approvePending = useCallback(async (explicitTaskId?: string) => {
    const tid = explicitTaskId || activeTaskIdRef.current || taskRef.current?.id || undefined;
    try {
      setError(null);
      await jarvisApi.approvePending(tid);
      setPendingApproval(null);
    } catch (err: any) {
      console.error("Error approving pending step:", err);
      setError(err.message || "Error al aprobar la operación pendiente.");
    }
  }, []);

  // Deny action (resolves taskId safely without sending null)
  const denyPending = useCallback(async (reason?: string, explicitTaskId?: string) => {
    const tid = explicitTaskId || activeTaskIdRef.current || taskRef.current?.id || undefined;
    try {
      setError(null);
      await jarvisApi.denyPending(tid, reason);
      setPendingApproval(null);
    } catch (err: any) {
      console.error("Error denying pending step:", err);
      setError(err.message || "Error al denegar la operación pendiente.");
    }
  }, []);

  // Hydrate PendingApproval object with interactive handlers for UI
  const hydratePendingApproval = useCallback(
    (raw: any, fallbackTaskId?: string): PendingApproval | null => {
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
        onApprove: () => {
          approvePending(associatedTaskId);
        },
        onDeny: (denyReason?: string) => {
          denyPending(denyReason, associatedTaskId);
        },
      };
    },
    [approvePending, denyPending]
  );

  const hydratePendingApprovalRef = useRef(hydratePendingApproval);
  useEffect(() => {
    hydratePendingApprovalRef.current = hydratePendingApproval;
  }, [hydratePendingApproval]);

  function extractUserQuestion(t: Task | null): string | null {
    if (!t || t.state !== "WAITING_INPUT" || t.waitingReason !== "user_answer") return null;
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

  // Fetch full state snapshot from backend
  const fetchState = useCallback(async () => {
    try {
      const data = await jarvisApi.getState(activeTaskIdRef.current || undefined);
      if (data.allTasks) {
        setAllTasks(data.allTasks);
        allTasksRef.current = data.allTasks;
      }
      if (data.task) {
        const taskId = data.task.id;
        const taskIters = (data.task.modelIterations && data.task.modelIterations.length > 0)
          ? data.task.modelIterations
          : iterationsByTaskRef.current[taskId];
        if (!taskIters || taskIters.length === 0) {
          const reconstructed = reconstructIterationsFromTask(data.task);
          iterationsByTaskRef.current[taskId] = reconstructed;
        } else {
          iterationsByTaskRef.current[taskId] = taskIters;
        }

        if (!isInitialSnapshotLoaded.current) {
          isInitialSnapshotLoaded.current = true;
          activeTaskIdRef.current = taskId;
          taskRef.current = data.task;
          setTask(data.task);
          setModelIterations(iterationsByTaskRef.current[taskId] || []);
        } else if (!userClearedViewRef.current || data.task.state === "RUNNING") {
          activeTaskIdRef.current = taskId;
          taskRef.current = data.task;
          setTask(data.task);
          setModelIterations(iterationsByTaskRef.current[taskId] || []);
        }

        if (data.task.state === "WAITING_INPUT" && data.task.waitingReason === "user_answer") {
          setUserQuestion((prev) => prev || extractUserQuestion(data.task));
        } else {
          setUserQuestion(null);
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

      // Resolve MCP initialization status after the first successful fetch
      if (!mcpInitDoneRef.current) {
        mcpInitDoneRef.current = true;
        const unavailable = data.unavailableServers ? Object.keys(data.unavailableServers).length : 0;
        const discovered = data.discoveredTools ? Object.keys(data.discoveredTools).length : 0;
        if (discovered === 0 && unavailable === 0) {
          // No tools and no errors: still initializing or no servers configured
          setMcpInitStatus("loading");
        } else if (unavailable === 0) {
          setMcpInitStatus("ready");
        } else if (discovered > 0) {
          setMcpInitStatus("partial");
        } else {
          setMcpInitStatus("error");
        }
      }
    } catch (err: any) {
      console.warn("Failed to fetch JARVIS state from backend:", err);
      if (!mcpInitDoneRef.current) {
        mcpInitDoneRef.current = true;
        setMcpInitStatus("error");
      }
    }
  }, [hydratePendingApproval]);

  const fetchStateRef = useRef(fetchState);
  useEffect(() => {
    fetchStateRef.current = fetchState;
  }, [fetchState]);

  // Subscribe to real-time events via Server-Sent Events (SSE)
  // Montaje único y conexión persistente sin cierres por cambios de dependencias (FRONT-02)
  useEffect(() => {
    fetchStateRef.current();

    let eventSource: EventSource | null = null;
    let fallbackPollInterval: NodeJS.Timeout | null = null;

    const startFallbackPolling = () => {
      if (!fallbackPollInterval) {
        fallbackPollInterval = setInterval(() => {
          fetchStateRef.current();
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
            // Buffer expandido a 500 eventos e indexado por taskId
            const taskEvents = eventsByTaskRef.current[event.taskId] || [];
            const updatedTaskEvents = [...taskEvents.slice(-499), event];
            eventsByTaskRef.current[event.taskId] = updatedTaskEvents;

            if (!activeTaskIdRef.current || event.taskId === activeTaskIdRef.current) {
              setEvents((prev) => [...prev.slice(-499), event]);
            }

            // Capturar pregunta interactiva del evento si requiere respuesta del usuario (FRONT-03)
            if (event.type === "TASK_STATE_CHANGED") {
              const evtData = (event.data || {}) as any;
              if (evtData.state === "WAITING_INPUT" && evtData.waitingReason === "user_answer") {
                setUserQuestion(evtData.question || null);
              } else if (evtData.state && evtData.state !== "WAITING_INPUT") {
                setUserQuestion(null);
              }
            }

            // Captura reactiva de iteración de modelo (Eos / Qwen)
            const currentContextTask = updatedTask || (event.taskId === taskRef.current?.id ? taskRef.current : null);
            const newIteration = createIterationFromEvent(event, currentContextTask);
            if (newIteration) {
              const taskIterList = iterationsByTaskRef.current[event.taskId] || [];
              if (!taskIterList.some((it) => it.id === newIteration.id)) {
                const nextList = [...taskIterList, newIteration];
                iterationsByTaskRef.current[event.taskId] = nextList;
                if (!activeTaskIdRef.current || event.taskId === activeTaskIdRef.current) {
                  setModelIterations(nextList);
                }
              }
            }
          }

          if (updatedTask) {
            taskRef.current = updatedTask;
            // Sincronizar allTasks inmutablemente en tiempo real (FRONT-01)
            setAllTasks((prev) => {
              const idx = prev.findIndex((t) => t.id === updatedTask.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = updatedTask;
                allTasksRef.current = next;
                return next;
              }
              const next = [...prev, updatedTask];
              allTasksRef.current = next;
              return next;
            });

            // Sincronizar pregunta de usuario si la tarea está en espera de respuesta
            if (updatedTask.state === "WAITING_INPUT" && updatedTask.waitingReason === "user_answer") {
              setUserQuestion((prev) => prev || extractUserQuestion(updatedTask));
            } else if (updatedTask.state !== "WAITING_INPUT") {
              setUserQuestion(null);
            }

            // Prevenir que SSE restaure inesperadamente una tarea inactiva si el usuario limpió la vista
            const matchesActive = activeTaskIdRef.current && updatedTask.id === activeTaskIdRef.current;
            const isFreshRunningTask = !activeTaskIdRef.current && updatedTask.state === "RUNNING";

            if (matchesActive || isFreshRunningTask) {
              userClearedViewRef.current = false;
              activeTaskIdRef.current = updatedTask.id;
              setTask({ ...updatedTask });

              // Sincronizar iteraciones de modelo priorizando las persistidas en el task
              const currentIters = (updatedTask.modelIterations && updatedTask.modelIterations.length > 0)
                ? updatedTask.modelIterations
                : (iterationsByTaskRef.current[updatedTask.id] || []);
              if (currentIters.length === 0 && updatedTask.steps && updatedTask.steps.length > 0) {
                const reconstructed = reconstructIterationsFromTask(updatedTask);
                iterationsByTaskRef.current[updatedTask.id] = reconstructed;
                setModelIterations(reconstructed);
              } else {
                iterationsByTaskRef.current[updatedTask.id] = currentIters;
                setModelIterations(currentIters);
              }
            }
          }

          if (rawPending !== undefined) {
            setPendingApproval(hydratePendingApprovalRef.current(rawPending, updatedTask?.id));
          }
        } catch (e) {
          console.error("Failed to parse JARVIS SSE message:", e);
        }
      };

      eventSource.onerror = () => {
        startFallbackPolling();
        fetchStateRef.current();
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
  }, []);

  // Initiate a new task on the backend
  const runTask = useCallback(
    async (message: string, executionMode?: "NORMAL" | "PLAN") => {
      if (!message.trim()) return;
      userClearedViewRef.current = false;
      setEvents([]);
      setModelIterations([]);
      setError(null);
      const effectiveMode = executionMode || mode;

      if (executionMode && executionMode !== mode) {
        setMode(executionMode);
      }

      try {
        const data = await jarvisApi.initiateTask(message, effectiveMode);
        if (data.task) {
          activeTaskIdRef.current = data.task.id;
          taskRef.current = data.task;
          setTask(data.task);
          setPendingApproval(null);
          // Sincronizar allTasks inmediatamente al iniciar la tarea (FRONT-01)
          setAllTasks((prev) => {
            const idx = prev.findIndex((t) => t.id === data.task.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = data.task;
              allTasksRef.current = next;
              return next;
            }
            const next = [...prev, data.task];
            allTasksRef.current = next;
            return next;
          });
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
      setUserQuestion(null);
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
      setMcpInitStatus("loading");
      const data = await jarvisApi.refreshDiscovery();
      if (data.tools) setDiscoveredTools(data.tools);
      if (data.extraCapabilities) setExtraCapabilities(data.extraCapabilities);
      if (data.unavailableServers) setUnavailableServers(data.unavailableServers);
      // Update init status after refresh
      const unavailable = data.unavailableServers ? Object.keys(data.unavailableServers).length : 0;
      const discovered = data.tools ? Object.keys(data.tools).length : 0;
      if (discovered === 0 && unavailable === 0) {
        setMcpInitStatus("error");
      } else if (unavailable === 0) {
        setMcpInitStatus("ready");
      } else if (discovered > 0) {
        setMcpInitStatus("partial");
      } else {
        setMcpInitStatus("error");
      }
    } catch (err: any) {
      console.warn("Failed to refresh discovery catalog:", err);
      setMcpInitStatus("error");
      setError(err.message || "Error al refrescar el catálogo de herramientas.");
    }
  }, []);

  // Limpiar vista local para iniciar una nueva consulta sin alterar el historial del backend
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

  // Seleccionar tarea previa del historial para visualización de solo lectura
  const selectHistoricalTask = useCallback(
    async (taskId: string) => {
      let found = allTasks.find((t) => t.id === taskId) || allTasksRef.current.find((t) => t.id === taskId);
      // Los listados y el SSE no transportan `modelIterations`: si no hay traza conocida, se pide la tarea completa.
      const knownIterations = iterationsByTaskRef.current[taskId];
      const needsFullTask = !found
        || (!(found.modelIterations && found.modelIterations.length > 0) && !(knownIterations && knownIterations.length > 0));
      if (needsFullTask) {
        try {
          const data = await jarvisApi.getState(taskId);
          if (data.task && data.task.id === taskId) {
            const fetchedTask: Task = data.task;
            found = fetchedTask;
            setAllTasks((prev) => {
              const idx = prev.findIndex((t) => t.id === taskId);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = fetchedTask;
                allTasksRef.current = next;
                return next;
              }
              const next = [...prev, fetchedTask];
              allTasksRef.current = next;
              return next;
            });
          }
        } catch (e) {
          console.warn("Failed to retrieve historical task:", e);
        }
      }

      if (found) {
        userClearedViewRef.current = false;
        activeTaskIdRef.current = found.id;
        taskRef.current = found;
        setTask({ ...found });
        setPendingApproval(null);
        setError(null);

        if (found.state === "WAITING_INPUT" && found.waitingReason === "user_answer") {
          setUserQuestion(extractUserQuestion(found));
        } else {
          setUserQuestion(null);
        }

        // Restaurar eventos registrados para esta tarea
        setEvents(eventsByTaskRef.current[found.id] || []);

        // Restaurar iteraciones o reconstruirlas a partir del snapshot del task
        const existingIter = iterationsByTaskRef.current[found.id] || [];
        const finalIter = (found.modelIterations && found.modelIterations.length > 0)
          ? found.modelIterations
          : (existingIter.length > 0 ? existingIter : reconstructIterationsFromTask(found));
        iterationsByTaskRef.current[found.id] = finalIter;
        setModelIterations(finalIter);
      }
    },
    [allTasks]
  );

  // Los campos crudos que antes duplicaban la traza (rawInteractions, step/call rawInput) se derivan de modelIterations.
  const taskView = useMemo(() => (task ? deriveTaskView(task, modelIterations) : task), [task, modelIterations]);

  return {
    task: taskView,
    allTasks,
    mode,
    setMode,
    pendingApproval,
    userQuestion,
    events,
    modelIterations,
    discoveredTools,
    extraCapabilities,
    unavailableServers,
    mcpInitStatus,
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