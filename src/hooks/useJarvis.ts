/**
 * React Hook for JARVIS Core Orchestration
 * Exposes reactive state, event stream, and action handlers with task isolation.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { JarvisCore } from "../core/core.ts";
import { Task, PendingApproval, CoreEvent, MCPTool } from "../core/types.ts";
import { MCPPrompt, MCPResourceTemplate } from "../core/mcp/types.ts";

export function useJarvis() {
  const coreRef = useRef<JarvisCore | null>(null);
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

  // Initialize Core instance once
  useEffect(() => {
    const core = new JarvisCore();
    coreRef.current = core;

    // Load initial discovery catalog and extra capabilities
    const disc = core.getDiscoveryEngine();
    disc.discoverAll().then((tools) => {
      setDiscoveredTools(tools);
    }).catch(() => {
      // MCP servers not running yet locally - keep empty without failing
      setDiscoveredTools({});
    });

    disc.discoverExtraCapabilities().then((extra) => {
      setExtraCapabilities(extra);
    }).catch(() => {
      setExtraCapabilities({ prompts: {}, resourceTemplates: {} });
    });

    // Check for any persisted active task
    const allTasks = core.getAllTasks();
    if (allTasks.length > 0) {
      const latest = allTasks[allTasks.length - 1];
      activeTaskIdRef.current = latest.id;
      setTask(latest);
      setPendingApproval(core.getPendingApproval(latest.id));
    }

    const unsubscribe = core.addEventListener((event) => {
      // Filter events to active task
      if (!activeTaskIdRef.current || event.taskId === activeTaskIdRef.current) {
        setEvents((prev) => [...prev.slice(-49), event]);
        const currentTask = core.getTask(event.taskId);
        if (currentTask) {
          setTask({ ...currentTask, steps: [...currentTask.steps], scratchpad: { ...currentTask.scratchpad } });
        }
        setPendingApproval(core.getPendingApproval(event.taskId));
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const runTask = useCallback(
    async (message: string, executionMode?: "NORMAL" | "PLAN") => {
      if (!coreRef.current || !message.trim()) return;
      setEvents([]);
      const effectiveMode = executionMode || mode;
      const createdTask = await coreRef.current.initiateTask(message, effectiveMode);
      activeTaskIdRef.current = createdTask.id;
      setTask(createdTask);
    },
    [mode]
  );

  const cancelTask = useCallback(() => {
    if (!coreRef.current || !activeTaskIdRef.current) return;
    coreRef.current.cancelTask(activeTaskIdRef.current);
  }, []);

  const confirmPlan = useCallback(() => {
    if (!coreRef.current || !activeTaskIdRef.current) return;
    coreRef.current.confirmPlan(activeTaskIdRef.current);
  }, []);

  const approvePending = useCallback(() => {
    pendingApproval?.onApprove();
  }, [pendingApproval]);

  const denyPending = useCallback(
    (reason?: string) => {
      pendingApproval?.onDeny(reason);
    },
    [pendingApproval]
  );

  const refreshDiscovery = useCallback(async () => {
    if (!coreRef.current) return;
    const disc = coreRef.current.getDiscoveryEngine();
    try {
      const tools = await disc.discoverAll();
      const extra = await disc.discoverExtraCapabilities();
      setDiscoveredTools(tools);
      setExtraCapabilities(extra);
    } catch {
      // Expected if local MCP daemon is not active
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
