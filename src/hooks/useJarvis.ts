/**
 * React Hook for JARVIS Client
 * 
 * Communicates exclusively with the authoritative Node.js JARVIS backend via HTTP / SSE.
 * Does NOT instantiate or bundle JarvisCore, DiscoveryEngine, Decision20Engine,
 * QwenEngine, child_process, or any MCP transport inside the browser.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Task, PendingApproval, CoreEvent, MCPTool } from "../core/types.ts";
import { MCPPrompt, MCPResourceTemplate } from "../core/mcp/types.ts";
import { getApiUrl } from "../utils/apiUrl.ts";

export function useJarvis() {
  const activeTaskIdRef = useRef<string | null>(null);

  const [task, setTask] = useState<Task | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [events, setEvents] = useState<CoreEvent[]>([]);
  const [discoveredTools, setDiscoveredTools] = useState<Record<string, MCPTool[]>>({});
  const [extraCapabilities, setExtraCapabilities] = useState<{
    prompts: Record<string, MCPPrompt[]>;
    resourceTemplates: Record<string, MCPResourceTemplate[]>;
  }>({ prompts: {}, resourceTemplates: {} });
  const [mode, setMode] = useState<"NORMAL" | "PLAN">("NORMAL");

  // Approve action
  const approvePending = useCallback(async () => {
    try {
      await fetch(getApiUrl("/api/jarvis/approve"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: activeTaskIdRef.current }),
      });
      setPendingApproval(null);
    } catch (err) {
      console.error("Error approving pending step:", err);
    }
  }, []);

  // Deny action
  const denyPending = useCallback(async (reason?: string) => {
    try {
      await fetch(getApiUrl("/api/jarvis/deny"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: activeTaskIdRef.current, reason }),
      });
      setPendingApproval(null);
    } catch (err) {
      console.error("Error denying pending step:", err);
    }
  }, []);

  // Hydrate PendingApproval object with interactive handlers for UI
  const hydratePendingApproval = useCallback(
    (raw: any): PendingApproval | null => {
      if (!raw) return null;
      return {
        id: raw.id,
        stepId: raw.stepId,
        mcp: raw.mcp,
        tool: raw.tool,
        capability: raw.capability,
        args: raw.args || {},
        reason: raw.reason || "",
        onApprove: () => {
          approvePending();
        },
        onDeny: (denyReason?: string) => {
          denyPending(denyReason);
        },
      };
    },
    [approvePending, denyPending]
  );

  // Fetch full state snapshot from backend
  const fetchState = useCallback(async () => {
    try {
      const url = activeTaskIdRef.current
        ? getApiUrl(`/api/jarvis/state?taskId=${encodeURIComponent(activeTaskIdRef.current)}`)
        : getApiUrl("/api/jarvis/state");

      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      if (data.task) {
        setTask(data.task);
        if (!activeTaskIdRef.current) {
          activeTaskIdRef.current = data.task.id;
        }
      }
      if (data.pendingApproval) {
        setPendingApproval(hydratePendingApproval(data.pendingApproval));
      } else {
        setPendingApproval(null);
      }
      if (data.discoveredTools && Object.keys(data.discoveredTools).length > 0) {
        setDiscoveredTools(data.discoveredTools);
      }
      if (data.extraCapabilities) {
        setExtraCapabilities(data.extraCapabilities);
      }
    } catch (err) {
      console.warn("Failed to fetch JARVIS state from backend:", err);
    }
  }, [hydratePendingApproval]);

  // Subscribe to real-time events via Server-Sent Events (SSE)
  useEffect(() => {
    // 1. Initial snapshot fetch
    fetchState();

    // 2. Open SSE stream
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(getApiUrl("/api/jarvis/events"));

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
            if (!activeTaskIdRef.current || updatedTask.id === activeTaskIdRef.current) {
              setTask({ ...updatedTask });
            }
          }

          if (rawPending !== undefined) {
            setPendingApproval(hydratePendingApproval(rawPending));
          }
        } catch (e) {
          console.error("Failed to parse JARVIS SSE message:", e);
        }
      };

      eventSource.onerror = () => {
        // Fallback polling if SSE disconnects
        fetchState();
      };
    } catch (err) {
      console.warn("EventSource not supported or failed to connect:", err);
    }

    // 3. Fallback polling interval to ensure sync
    const pollInterval = setInterval(() => {
      fetchState();
    }, 3000);

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      clearInterval(pollInterval);
    };
  }, [fetchState, hydratePendingApproval]);

  // Initiate a new task on the backend
  const runTask = useCallback(
    async (message: string, executionMode?: "NORMAL" | "PLAN") => {
      if (!message.trim()) return;
      setEvents([]);
      const effectiveMode = executionMode || mode;

      try {
        const res = await fetch(getApiUrl("/api/jarvis/process"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: message.trim(), mode: effectiveMode }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data.task) {
          activeTaskIdRef.current = data.task.id;
          setTask(data.task);
          setPendingApproval(null);
        }
      } catch (err) {
        console.error("Failed to initiate task on backend:", err);
      }
    },
    [mode]
  );

  // Cancel task
  const cancelTask = useCallback(async () => {
    try {
      await fetch(getApiUrl("/api/jarvis/cancel"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: activeTaskIdRef.current }),
      });
      fetchState();
    } catch (err) {
      console.error("Failed to cancel task on backend:", err);
    }
  }, [fetchState]);

  // Confirm plan
  const confirmPlan = useCallback(async () => {
    try {
      await fetch(getApiUrl("/api/jarvis/confirm-plan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: activeTaskIdRef.current }),
      });
      fetchState();
    } catch (err) {
      console.error("Failed to confirm plan on backend:", err);
    }
  }, [fetchState]);

  // Refresh discovery catalog
  const refreshDiscovery = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/jarvis/refresh-discovery"), {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.tools) setDiscoveredTools(data.tools);
        if (data.extraCapabilities) setExtraCapabilities(data.extraCapabilities);
      }
    } catch (err) {
      console.warn("Failed to refresh discovery catalog:", err);
    }
  }, []);

  return {
    task,
    mode,
    setMode,
    pendingApproval,
    events,
    discoveredTools,
    extraCapabilities,
    isExecuting: task?.state === "RUNNING",
    runTask,
    cancelTask,
    confirmPlan,
    approvePending,
    denyPending,
    refreshDiscovery,
  };
}
