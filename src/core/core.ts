/**
 * JARVIS Core — Unified Reactive Engine & Deterministic Authority
 * Modos FAST y PLAN sobre un único motor de ejecución.
 */

import path from "node:path";
import {
  MAX_RETAINED_TASKS,
  isTerminalState,
  type CoreEvent,
  type CoreEventType,
  type PendingApproval,
  type Task,
  type TaskState,
} from "./types.ts";
import { Decision20Engine } from "./decision.ts";
import { DiscoveryEngine } from "./mcp/discovery.ts";
import { QwenEngine, type ILLMClient } from "./reasoner/qwen.ts";
import { RequestAbortedError } from "./llmTransport.ts";
import { type TaskExecutionContext, addLogEntry, createEmptyMemory } from "./context.ts";
import { TaskStore, compactLegacyDuplicates, refArchive } from "./persistence.ts";
import type { EngineDependencies } from "./callExecutor.ts";
import { RefStore, sanitizeForMemory } from "./processor/resultProcessor.ts";
import {
  failTask,
  runFastLoop,
  initiatePlanMode,
  runPlanLoop,
  planStepsToSteps,
} from "./modeEngines.ts";
import {
  createIterationFromEvent,
  reconstructIterationsFromTask,
} from "../utils/debugAccumulator.ts";

export type { TaskExecutionContext } from "./context.ts";
export type CoreEventListener = (event: CoreEvent) => void;

const TASKS_FILE_PATH = path.resolve(process.cwd(), "jarvis-tasks.json");

export class JarvisCore {
  private decisionEngine: Decision20Engine;
  private discoveryEngine: DiscoveryEngine;
  private qwenEngine: ILLMClient;
  private taskContexts: Map<string, TaskExecutionContext> = new Map();
  private listeners: Set<CoreEventListener> = new Set();
  private store: TaskStore;

  constructor(
    decisionEngine?: Decision20Engine,
    discoveryEngine?: DiscoveryEngine,
    qwenEngine?: ILLMClient
  ) {
    this.decisionEngine = decisionEngine || new Decision20Engine();
    this.discoveryEngine = discoveryEngine || new DiscoveryEngine();
    this.qwenEngine = qwenEngine || new QwenEngine();
    this.store = new TaskStore(TASKS_FILE_PATH, () => this.snapshotForDisk());
    // Al liberar las referencias de una tarea (fin, cancelación, fallo) se archivan para el historial.
    RefStore.setArchiver((taskId, refs) => refArchive.save(taskId, refs));
    this.loadPersistedTasks();
    refArchive.prune(new Set(this.taskContexts.keys()));
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

    // Transiciones que no deben perderse ante un corte: espera del usuario y estados terminales.
    if (type === "TASK_STATE_CHANGED") {
      const state = data.state;
      if (typeof state === "string" && (state === "WAITING_INPUT" || isTerminalState(state as TaskState))) {
        this.store.saveNow();
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
    this.persistTasks();
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

    RefStore.clear(taskId);
    this.persistTasks();
    console.log(
      `[Task Summary] id=${taskId} state=CANCELLED reason="Cancelada por usuario" calls=${context.totalToolCalls} escalations=${context.escalations} duration=${Date.now() - context.startTime}ms`
    );
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "CANCELLED" });
  }

  confirmPlan(taskId: string): void {
    const context = this.taskContexts.get(taskId);
    if (!context || !this.isAwaitingPlanConfirmation(context)) return;

    context.task.planConfirmed = true;
    context.task.state = "RUNNING";
    context.task.waitingReason = undefined;
    this.persistTasks();
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "RUNNING", planConfirmed: true });

    this.runDetached(context, () => runPlanLoop(context, this.getEngineDeps()));
  }

  rejectPlan(taskId: string, reason?: string): void {
    const context = this.taskContexts.get(taskId);
    if (!context || !this.isAwaitingPlanConfirmation(context)) return;

    context.task.state = "CANCELLED";
    context.task.waitingReason = undefined;
    context.task.planConfirmed = false;
    RefStore.clear(taskId);
    this.persistTasks();
    this.emitEvent(taskId, "PLAN_REJECTED", { reason: reason || "Plan rechazado por el usuario." });
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "CANCELLED" });
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
      reportFailure(err instanceof Error ? err.message : String(err));
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
    });
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "WAITING_INPUT", waitingReason: "plan_confirmation" });
    // Persistir después de emitir: PLAN_GENERATED añade su iteración al task.
    this.persistTasks();
  }

  /**
   * Responde la pregunta abierta de una tarea en WAITING_INPUT/user_answer.
   * La respuesta queda en la memoria (fact `answer_<paso>` + línea de LOG) y en `task.userAnswers`; el paso que
   * originó la pregunta se reabre (PENDING) para ejecutarse de nuevo con esa información, y las firmas anti-loop
   * previas dejan de aplicar porque el estado cambió.
   */
  provideUserAnswer(taskId: string, answer: string): void {
    const context = this.taskContexts.get(taskId);
    if (!context || context.isCancelled) return;
    const { task } = context;
    if (task.state !== "WAITING_INPUT" || task.waitingReason !== "user_answer") return;

    const clean = answer.trim();
    if (!clean) {
      console.warn(`[JarvisCore] Respuesta vacía ignorada para tarea '${taskId}'; sigue esperando.`);
      return;
    }

    // Paso al que pertenece la pregunta. Tareas persistidas antes de `pendingQuestion`: último paso vigente UNVERIFIED.
    const pending = task.pendingQuestion;
    let step = pending ? task.steps.find((s) => s.id === pending.stepId) : undefined;
    if (!step) {
      for (let i = task.steps.length - 1; i >= 0; i--) {
        if (!task.steps[i].superseded && task.steps[i].state === "UNVERIFIED") {
          step = task.steps[i];
          break;
        }
      }
    }

    task.memory = task.memory || createEmptyMemory();
    task.memory.facts[step ? `answer_${step.id}` : `user_input_${Date.now()}`] = sanitizeForMemory(clean, 400);
    addLogEntry(
      context,
      `${step?.id ?? `s${task.stepSeq ?? 0}`}|user|ok|${sanitizeForMemory(`${pending?.question ?? "pregunta"} -> ${clean}`, 200)}`
    );
    task.userAnswers = task.userAnswers || [];
    task.userAnswers.push({ stepId: step?.id, question: pending?.question, answer: clean, answeredAt: Date.now() });
    task.pendingQuestion = undefined;

    if (step && task.mode === "PLAN") {
      step.state = "PENDING";
      step.error = undefined;
    }
    context.nonReadCounter++;

    task.state = "RUNNING";
    task.waitingReason = undefined;
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "RUNNING", userAnswerProvided: true, stepId: step?.id });
    this.persistTasks();

    const deps = this.getEngineDeps();
    this.runDetached(context, () =>
      task.mode === "PLAN" ? runPlanLoop(context, deps) : runFastLoop(context, deps)
    );
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

  // --- Persistence ---

  /** Solicita una escritura agrupada y atómica (ver TaskStore). */
  private persistTasks(): void {
    this.store.schedule();
  }

  /** Vuelca de inmediato lo pendiente. Para un cierre ordenado del servidor. */
  flushPersistence(): void {
    this.store.flushSync();
  }

  private snapshotForDisk(): Task[] {
    this.pruneTasks();
    return Array.from(this.taskContexts.values()).map((ctx) => ctx.task);
  }

  /**
   * Conserva a lo sumo MAX_RETAINED_TASKS tareas, en memoria y en disco. Se expulsan primero las terminales más
   * antiguas (con sus referencias archivadas); una tarea RUNNING nunca se expulsa. Con `cancelAbandoned` (al crear
   * una tarea nueva), si aún se rebasa el tope, se cancelan y expulsan las tareas en espera del usuario más antiguas.
   */
  private pruneTasks(cancelAbandoned = false): void {
    this.evictTerminalTasks();
    if (!cancelAbandoned) return;

    // Las tareas en espera del usuario (aprobación, confirmación de plan, pregunta) no son terminales y, abandonadas,
    // se acumularían sin límite. Rebasado el tope, las más antiguas se cancelan (liberando su promesa de aprobación y
    // sus referencias) y se expulsan. Una tarea RUNNING nunca se toca.
    while (this.taskContexts.size > MAX_RETAINED_TASKS) {
      const abandoned = Array.from(this.taskContexts.values()).find((c) => c.task.state === "WAITING_INPUT");
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
      RefStore.discard(id);
      refArchive.remove(id);
      this.taskContexts.delete(id);
    }
  }

  private loadPersistedTasks(): void {
    try {
      const tasks = this.store.load() as Task[];
      let migrated = false;
      for (const task of tasks) {
        task.memory = task.memory || createEmptyMemory();
        task.replans = task.replans ?? 0;
        task.escalations = task.escalations ?? 0;
        task.stepSeq = task.stepSeq ?? task.steps.length;
        task.modelIterations = task.modelIterations || [];
        if (task.modelIterations.length === 0 && task.steps.length > 0) {
          task.modelIterations = reconstructIterationsFromTask(task);
        }
        // Migración sin pérdida: copias crudas heredadas que ya existen idénticas en modelIterations.
        if (compactLegacyDuplicates(task)) migrated = true;

        // Tras un reinicio no queda ninguna promesa que reanude una ejecución en curso ni una aprobación pendiente.
        // plan_confirmation y user_answer sí son reanudables: dependen de una nueva acción del usuario.
        const interruptedRun = task.state === "RUNNING";
        const orphanedApproval = task.state === "WAITING_INPUT" && task.waitingReason === "approval";
        if (interruptedRun || orphanedApproval) {
          migrated = true;
          task.state = "CANCELLED";
          task.waitingReason = undefined;
          task.finalResponse = task.finalResponse || (orphanedApproval
            ? "Tarea cancelada: el servidor se reinició con una aprobación pendiente."
            : "Tarea interrumpida: servidor reiniciado durante la ejecución.");
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
        // Tareas terminadas antes de existir esta normalización conservan `planConfirmed: false`.
        if (isTerminalState(task.state) && task.planConfirmed === false) {
          task.planConfirmed = undefined;
          migrated = true;
        }
        // La pregunta abierta solo tiene sentido mientras la tarea la espera.
        if (task.state === "WAITING_INPUT" && task.waitingReason === "user_answer") {
          if (!task.pendingQuestion) {
            // Tarea persistida antes de existir `pendingQuestion`: lo único disponible es el motivo del paso UNVERIFIED.
            const waiting = [...task.steps].reverse().find((s) => !s.superseded && s.state === "UNVERIFIED");
            if (waiting) {
              task.pendingQuestion = {
                stepId: waiting.id,
                question: waiting.error || "Se requiere información adicional.",
                reason: waiting.error || "",
                askedAt: Date.now(),
              };
            }
          }
        } else {
          task.pendingQuestion = undefined;
        }
        this.taskContexts.set(task.id, JarvisCore.createContext(task));
      }
      this.pruneTasks();
      // Si la carga corrigió algo (migración, tareas interrumpidas), el archivo se actualiza.
      if (migrated) this.persistTasks();
    } catch (e) {
      console.warn("[JarvisCore] Error al cargar tareas persistidas desde archivo local:", e);
    }
  }
}