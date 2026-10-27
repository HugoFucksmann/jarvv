/**
 * JARVIS Core — Unified Reactive Engine & Deterministic Authority
 * Modos FAST y PLAN sobre un único motor de ejecución.
 */

import {
  MAX_RETAINED_TASKS,
  isTerminalState,
  type CoreEvent,
  type CoreEventType,
  type PendingApproval,
  type Task,
} from "./types.ts";
import { Decision20Engine } from "./decision.ts";
import { DiscoveryEngine } from "./mcp/discovery.ts";
import { QwenEngine, type ILLMClient } from "./reasoner/qwen.ts";
import { RequestAbortedError } from "./llmTransport.ts";
import { type TaskExecutionContext, createEmptyMemory, ensureMemory } from "./context.ts";
import type { EngineDependencies } from "./callExecutor.ts";
import { RefStore } from "./processor/refStore.ts";
import { sanitizeForMemory } from "./processor/text.ts";

import {
  runFastLoop,
  initiatePlanMode,
  runPlanLoop,
  planStepsToSteps,
} from "./modeEngines.ts";
import { errorMessage, failTask } from "./taskConclusion.ts";
import { createIterationFromEvent } from "./modelIterations.ts";
import { recordTaskTrace } from "./taskTrace.ts";

export type { TaskExecutionContext } from "./context.ts";
export type CoreEventListener = (event: CoreEvent) => void;

export class JarvisCore {
  private decisionEngine: Decision20Engine;
  private discoveryEngine: DiscoveryEngine;
  private qwenEngine: ILLMClient;
  private taskContexts: Map<string, TaskExecutionContext> = new Map();
  private listeners: Set<CoreEventListener> = new Set();

  constructor(
    decisionEngine?: Decision20Engine,
    discoveryEngine?: DiscoveryEngine,
    qwenEngine?: ILLMClient
  ) {
    this.decisionEngine = decisionEngine || new Decision20Engine();
    this.discoveryEngine = discoveryEngine || new DiscoveryEngine();
    this.qwenEngine = qwenEngine || new QwenEngine();
  }

  private getEngineDeps(): EngineDependencies {
    return {
      decisionEngine: this.decisionEngine,
      discoveryEngine: this.discoveryEngine,
      qwenEngine: this.qwenEngine,
      emitEvent: (taskId, type, data, stepId) => this.emitEvent(taskId, type, data, stepId),
    };
  }

  private static createContext(task: Task): TaskExecutionContext {
    return {
      task,
      abortController: new AbortController(),
      isCancelled: task.state === "CANCELLED",
      pendingApproval: null,
      executedSignatures: new Set(),
      nonReadCounter: 0,
      lastActionWasRead: false,
      consecutiveLoopBlocks: 0,
      totalToolCalls: 0,
      escalations: task.escalations ?? 0,
      startTime: Date.now(),
      memoryRetrievalLimit: 2,
      dataObs: [],
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

    // Almacenamiento determinista en memoria/contexto de la iteración de modelo
    const ctx = this.taskContexts.get(taskId);
    if (ctx?.task) {
      // `planConfirmed === false` significa "esperando confirmación del plan": al terminar la tarea ya no aplica.
      if (ctx.task.planConfirmed === false && isTerminalState(ctx.task.state)) {
        ctx.task.planConfirmed = undefined;
      }
      const iteration = createIterationFromEvent(event, ctx.task);
      if (iteration) {
        ctx.task.modelIterations = ctx.task.modelIterations || [];
        const existingIdx = ctx.task.modelIterations.findIndex((it) => it.id === iteration.id);
        if (existingIdx >= 0) {
          ctx.task.modelIterations[existingIdx] = iteration;
        } else {
          ctx.task.modelIterations.push(iteration);
        }
      }
    }

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

  // --- Fallos de pipeline ---

  /** Lanza trabajo en segundo plano; cualquier excepción cierra la tarea por el único punto de cierre (failTask). */
  private runDetached(context: TaskExecutionContext, work: () => Promise<void>): void {
    work().catch((err) => failTask(context, this.getEngineDeps(), err));
  }

  private isAwaitingPlanConfirmation(context: TaskExecutionContext): boolean {
    return !context.isCancelled
      && context.task.mode === "PLAN"
      && context.task.state === "WAITING_INPUT"
      && context.task.waitingReason === "plan_confirmation";
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
      memory: createEmptyMemory(),
      replans: 0,
      escalations: 0,
      stepSeq: 0,
    };

    const context = JarvisCore.createContext(task);

    console.log(`[Task] start id=${taskId} mode=${mode}`);
    this.taskContexts.set(taskId, context);
    this.pruneTasks(true);
    this.emitEvent(taskId, "TASK_CREATED", { task });

    this.runDetached(context, () => this.runTaskPipeline(context));

    return task;
  }

  cancelTask(taskId: string): void {
    const context = this.taskContexts.get(taskId);
    if (!context || isTerminalState(context.task.state) || context.isCancelled) return;
    context.isCancelled = true;
    context.abortController.abort();
    context.task.state = "CANCELLED";
    context.task.pendingQuestion = undefined;

    if (context.pendingApproval) {
      context.pendingApproval.onDeny("Operación cancelada por el usuario.");
      context.pendingApproval = null;
    }

    const currentStep = context.task.steps[context.task.currentStep];
    if (currentStep && (currentStep.state === "RUNNING" || currentStep.state === "WAITING_APPROVAL" || currentStep.state === "PENDING")) {
      currentStep.state = "FAILED";
      currentStep.error = "CANCELLED";
    }

    console.log(
      `[Task Summary] id=${taskId} state=CANCELLED reason="Cancelada por usuario" calls=${context.totalToolCalls} escalations=${context.escalations} duration=${Date.now() - context.startTime}ms`
    );
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "CANCELLED" });
    recordTaskTrace(context);
  }

  confirmPlan(taskId: string): void {
    const context = this.taskContexts.get(taskId);
    if (!context || !this.isAwaitingPlanConfirmation(context)) return;

    context.task.planConfirmed = true;
    context.task.state = "RUNNING";
    context.task.waitingReason = undefined;
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "RUNNING", planConfirmed: true });

    this.runDetached(context, () => runPlanLoop(context, this.getEngineDeps()));
  }

  rejectPlan(taskId: string, reason?: string): void {
    const context = this.taskContexts.get(taskId);
    if (!context || !this.isAwaitingPlanConfirmation(context)) return;

    context.isCancelled = true;
    context.task.state = "CANCELLED";
    context.task.waitingReason = undefined;
    this.emitEvent(taskId, "PLAN_REJECTED", { reason: reason || "Plan rechazado por el usuario." });
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "CANCELLED" });
    recordTaskTrace(context);
    console.log(`[JarvisCore] Plan rechazado por el usuario para tarea '${taskId}'.`);
  }

  /** Solo se puede modificar un plan que espera confirmación. El plan vigente se conserva si la modificación falla. */
  async modifyPlan(taskId: string, feedback: string): Promise<void> {
    const context = this.taskContexts.get(taskId);
    if (!context || !this.isAwaitingPlanConfirmation(context)) return;
    const { task } = context;

    console.log(`[JarvisCore] Modificación de plan solicitada para tarea '${taskId}': "${feedback}"`);
    const existingPlanSummary = task.steps
      .map((s, idx) => `${idx + 1}. [${s.route}] ${s.instruction} -> ${s.expectedOutcome || "ok"}`)
      .join("\n");

    const reportFailure = (error: string) => {
      console.error(`[JarvisCore] Error al modificar plan: ${error}`);
      this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "WAITING_INPUT", waitingReason: "plan_confirmation", error });
    };

    let newPlan;
    try {
      newPlan = await this.qwenEngine.generatePlan(
        task.message,
        undefined,
        context.abortController.signal,
        undefined,
        feedback,
        existingPlanSummary
      );
    } catch (err) {
      if (err instanceof RequestAbortedError) return;
      reportFailure(errorMessage(err));
      return;
    }

    // Durante la generación el usuario pudo confirmar, rechazar o cancelar: ese resultado ya no aplica.
    if (!this.isAwaitingPlanConfirmation(context)) return;

    if (newPlan.steps.length === 0) {
      reportFailure("La modificación no produjo pasos; se conserva el plan vigente.");
      return;
    }

    task.steps = planStepsToSteps(newPlan.steps, 0);
    task.stepSeq = task.steps.length;
    task.planConfirmed = false;
    task.rawPlanInput = newPlan.rawInput;
    task.rawPlanOutput = newPlan.rawOutput;
    this.emitEvent(taskId, "PLAN_MODIFIED", { feedback, steps: task.steps });
    this.emitEvent(taskId, "PLAN_GENERATED", {
      steps: task.steps,
      rawInput: newPlan.rawInput,
      rawOutput: newPlan.rawOutput,
      timing: newPlan.timing,
    });
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "WAITING_INPUT", waitingReason: "plan_confirmation" });
  }

  /**
   * Responde la pregunta abierta de una tarea PLAN en WAITING_INPUT/user_answer. La respuesta se guarda como fact
   * (`answer_<paso>`, para el resto de la tarea) y se anexa a la instrucción del paso, que se reabre (PENDING): así
   * llega a Decision #2, a Eos y a Qwen sin tocar sus prompts. `nonReadCounter` invalida las firmas anti-loop previas.
   * Devuelve false si la respuesta no se aplicó (tarea inexistente o que no espera respuesta, o respuesta vacía),
   * para que el endpoint no confirme como hecho algo que se ignoró.
   */
  provideUserAnswer(taskId: string, answer: string): boolean {
    const context = this.taskContexts.get(taskId);
    if (!context || context.isCancelled) return false;
    const { task } = context;
    const pending = task.pendingQuestion;
    if (task.mode !== "PLAN" || task.state !== "WAITING_INPUT" || task.waitingReason !== "user_answer" || !pending) return false;

    const clean = answer.trim();
    if (!clean) {
      console.warn(`[JarvisCore] Respuesta vacía ignorada para tarea '${taskId}'; sigue esperando.`);
      return false;
    }

    ensureMemory(context).facts[`answer_${pending.stepId}`] = sanitizeForMemory(`${pending.question} -> ${clean}`, Number.POSITIVE_INFINITY);
    task.userAnswers = [
      ...(task.userAnswers ?? []),
      { stepId: pending.stepId, question: pending.question, answer: clean, answeredAt: Date.now() },
    ];
    task.pendingQuestion = undefined;

    const step = task.steps.find((s) => s.id === pending.stepId);
    if (step) {
      step.instruction += ` | Respuesta del usuario a "${sanitizeForMemory(pending.question, 100)}": ${sanitizeForMemory(clean, Number.POSITIVE_INFINITY)}`;
      step.state = "PENDING";
      step.error = undefined;
    }
    context.nonReadCounter++;

    task.state = "RUNNING";
    task.waitingReason = undefined;
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "RUNNING", userAnswerProvided: true, stepId: pending.stepId });

    this.runDetached(context, () => runPlanLoop(context, this.getEngineDeps()));
    return true;
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

  private pruneTasks(cancelAbandoned = false): void {
    this.evictTerminalTasks();
    if (!cancelAbandoned) return;

    while (this.taskContexts.size > MAX_RETAINED_TASKS) {
      let abandoned: TaskExecutionContext | undefined;
      for (const c of this.taskContexts.values()) {
        if (c.task.state === "WAITING_INPUT") {
          abandoned = c;
          break;
        }
      }
      if (!abandoned) break;
      console.warn(`[JarvisCore] Tope de ${MAX_RETAINED_TASKS} tareas: se cancela la tarea en espera más antigua '${abandoned.task.id}'.`);
      this.cancelTask(abandoned.task.id);
      this.evictTerminalTasks();
    }
  }

  private evictTerminalTasks(): void {
    if (this.taskContexts.size <= MAX_RETAINED_TASKS) return;
    for (const [id, ctx] of this.taskContexts) {
      if (this.taskContexts.size <= MAX_RETAINED_TASKS) break;
      if (!isTerminalState(ctx.task.state)) continue;
      RefStore.clear(id);
      this.taskContexts.delete(id);
    }
  }
}