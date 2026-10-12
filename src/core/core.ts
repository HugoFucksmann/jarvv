/**
 * JARVIS Core v2.1 — Unified Reactive Engine & Deterministic Authority
 * Implements FAST and PLAN modes over a single execution engine (§1, §4, §8, §9)
 */

import fs from "node:fs";
import path from "node:path";
import {
  Task,
  CoreEvent,
  CoreEventType,
  PendingApproval,
} from "./types.ts";
import { Decision20Engine } from "./decision.ts";
import { DiscoveryEngine } from "./mcp/discovery.ts";
import { QwenEngine, ILLMClient } from "./reasoner/qwen.ts";
import { TaskExecutionContext } from "./context.ts";
import { EngineDependencies } from "./callExecutor.ts";
import { RefStore } from "./processor/resultProcessor.ts";
import {
  runFastLoop,
  initiatePlanMode,
  runPlanLoop,
} from "./modeEngines.ts";

export type { TaskExecutionContext } from "./context.ts";
export type CoreEventListener = (event: CoreEvent) => void;

const TASKS_FILE_PATH = path.resolve(process.cwd(), "jarvis-tasks.json");

export class JarvisCore {
  private decisionEngine: Decision20Engine;
  private discoveryEngine: DiscoveryEngine;
  private qwenEngine: ILLMClient;
  private taskContexts: Map<string, TaskExecutionContext> = new Map();
  private listeners: Set<CoreEventListener> = new Set();
  private sessionHistory: string[] = [];

  constructor(
    decisionEngine?: Decision20Engine,
    discoveryEngine?: DiscoveryEngine,
    qwenEngine?: ILLMClient
  ) {
    this.decisionEngine = decisionEngine || new Decision20Engine();
    this.discoveryEngine = discoveryEngine || new DiscoveryEngine();
    this.qwenEngine = qwenEngine || new QwenEngine();
    this.loadPersistedTasks();
  }

  private getEngineDeps(): EngineDependencies {
    return {
      decisionEngine: this.decisionEngine,
      discoveryEngine: this.discoveryEngine,
      qwenEngine: this.qwenEngine,
      emitEvent: (taskId, type, data, stepId) => this.emitEvent(taskId, type, data, stepId),
      persistTasks: () => this.persistTasks(),
    };
  }

  // --- Event Subscription ---
  addEventListener(listener: CoreEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitEvent(taskId: string, type: CoreEventType, data: Record<string, unknown> = {}, stepId?: string) {
    const event: CoreEvent = {
      type,
      timestamp: Date.now(),
      taskId,
      stepId,
      data,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("Event listener error:", err);
      }
    }
  }

  // --- Getters with Task Isolation ---
  getTask(taskId: string): Task | null {
    return this.taskContexts.get(taskId)?.task || null;
  }

  getPendingApproval(taskId?: string): PendingApproval | null {
    if (taskId) {
      return this.taskContexts.get(taskId)?.pendingApproval || null;
    }
    for (const ctx of this.taskContexts.values()) {
      if (ctx.pendingApproval) return ctx.pendingApproval;
    }
    return null;
  }

  getDiscoveryEngine(): DiscoveryEngine {
    return this.discoveryEngine;
  }

  getAllTasks(): Task[] {
    return Array.from(this.taskContexts.values()).map((ctx) => ctx.task);
  }

  // --- Task Initiation ---
  async initiateTask(message: string, mode: "NORMAL" | "PLAN" = "NORMAL"): Promise<Task> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const task: Task = {
      id: taskId,
      message,
      mode,
      steps: [],
      currentStep: 0,
      scratchpad: {},
      state: "RUNNING",
      memory: { log: [], facts: {}, fail: [] },
      replans: 0,
      escalations: 0,
      stepSeq: 0,
    };

    const context: TaskExecutionContext = {
      task,
      abortController: new AbortController(),
      isCancelled: false,
      pendingApproval: null,
      executedSignatures: new Set(),
      nonReadCounter: 0,
      lastActionWasRead: false,
      consecutiveLoopBlocks: 0,
      totalToolCalls: 0,
      escalations: 0,
      startTime: Date.now(),
      overridesCount: 0,
      retriesCount: 0,
    };

    console.log(`[Task] start id=${taskId} mode=${mode}`);
    this.taskContexts.set(taskId, context);
    this.sessionHistory.push(message);
    this.persistTasks();
    this.emitEvent(taskId, "TASK_CREATED", { task });

    // Execute pipeline independently
    this.runTaskPipeline(context).catch((err) => {
      const durationTotalMs = Date.now() - context.startTime;
      console.error(
        `[Task Summary] id=${taskId} state=FAILED reason="${err?.message || err}" calls=${context.totalToolCalls} escalations=${context.escalations} overrides=${context.overridesCount} retries=${context.retriesCount} duration=${durationTotalMs}ms`
      );
      RefStore.clear(taskId);
      if (context.task.state === "RUNNING") {
        context.task.state = "FAILED";
        this.persistTasks();
        this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "FAILED", error: String(err) });
      }
    });

    return task;
  }

  cancelTask(taskId: string): void {
    const context = this.taskContexts.get(taskId);
    if (!context || context.task.state !== "RUNNING") return;
    context.isCancelled = true;
    context.abortController.abort();
    context.task.state = "CANCELLED";

    if (context.pendingApproval) {
      context.pendingApproval.onDeny("Operación cancelada por el usuario.");
      context.pendingApproval = null;
    }

    const currentStep = context.task.steps[context.task.currentStep];
    if (currentStep && currentStep.state === "RUNNING") {
      currentStep.state = "FAILED";
      currentStep.error = "CANCELLED";
    }

    RefStore.clear(taskId);
    this.persistTasks();
    const durationTotalMs = Date.now() - context.startTime;
    console.log(
      `[Task Summary] id=${taskId} state=CANCELLED reason="Cancelada por usuario" calls=${context.totalToolCalls} escalations=${context.escalations} overrides=${context.overridesCount} retries=${context.retriesCount} duration=${durationTotalMs}ms`
    );
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "CANCELLED" });
  }

  confirmPlan(taskId: string): void {
    const context = this.taskContexts.get(taskId);
    if (!context || context.task.mode !== "PLAN") return;
    context.task.planConfirmed = true;
    this.persistTasks();
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { planConfirmed: true });

    runPlanLoop(context, this.getEngineDeps()).catch((err) => {
      console.error(`[Plan Resume Error] id=${taskId}`, err);
      RefStore.clear(taskId);
    });
  }

  // --- Pipeline Orchestration ---
  private async runTaskPipeline(context: TaskExecutionContext): Promise<void> {
    if (context.isCancelled) return;

    const deps = this.getEngineDeps();
    if (context.task.mode === "PLAN") {
      await initiatePlanMode(context, deps);
    } else {
      await runFastLoop(context, deps);
    }
  }

  // --- Persistence con soporte real para Node.js ---
  private persistTasks(): void {
    try {
      const serialized = Array.from(this.taskContexts.values()).map((ctx) => ctx.task);
      fs.writeFileSync(TASKS_FILE_PATH, JSON.stringify(serialized.slice(-20), null, 2), "utf-8");
    } catch (e) {
      console.warn("[JarvisCore] Error al persistir tareas en archivo local:", e);
    }
  }

  private loadPersistedTasks(): void {
    try {
      if (fs.existsSync(TASKS_FILE_PATH)) {
        const stored = fs.readFileSync(TASKS_FILE_PATH, "utf-8");
        if (stored) {
          const tasks: Task[] = JSON.parse(stored);
          for (const task of tasks) {
            task.memory = task.memory || { log: [], facts: {}, fail: [] };
            task.replans = task.replans ?? 0;
            task.escalations = task.escalations ?? 0;
            task.stepSeq = task.stepSeq ?? task.steps.length;
            if (task.state === "RUNNING") {
              task.state = "CANCELLED";
              task.finalResponse = task.finalResponse || "Tarea interrumpida: servidor reiniciado durante la ejecución.";
              for (const step of task.steps) {
                if (step.state === "RUNNING" || step.state === "WAITING_APPROVAL") {
                  step.state = "BLOCKED";
                  step.error = "Interrumpido por reinicio del servidor.";
                }
              }
            }
            for (const step of task.steps) {
              step.calls = step.calls || [];
              step.rev = step.rev ?? 0;
              step.superseded = step.superseded ?? false;
            }
            this.taskContexts.set(task.id, {
              task,
              abortController: new AbortController(),
              isCancelled: task.state === "CANCELLED",
              pendingApproval: null,
              executedSignatures: new Set(),
              nonReadCounter: 0,
              lastActionWasRead: false,
              consecutiveLoopBlocks: 0,
              totalToolCalls: 0,
              escalations: task.escalations,
              startTime: Date.now(),
              overridesCount: 0,
              retriesCount: 0,
            });
          }
        }
      }
    } catch (e) {
      console.warn("[JarvisCore] Error al cargar tareas persistidas desde archivo local:", e);
    }
  }
}