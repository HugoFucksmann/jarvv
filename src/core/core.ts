/**
 * JARVIS Core — Orquestador de tareas: ciclo de vida, cancelación, confirmación de planes y retención.
 * Los modos FAST y PLAN comparten un único motor de ejecución (modeEngines.ts).
 */

import {
  MAX_RETAINED_TASKS,
  isTerminalState,
  type CoreEvent,
  type CoreEventDataMap,
  type CoreEventType,
  type PendingApproval,
  type Plan,
  type StepState,
  type Task,
  type TaskMode,
} from "./types.ts";
import { RequestAbortedError } from "./llmTransport.ts";
import { type TaskExecutionContext, createEmptyMemory, createTaskContext, ensureMemory } from "./context.ts";
import type { EngineDependencies } from "./engineDeps.ts";
import { RefStore } from "./processor/refStore.ts";
import { sanitizeForMemory } from "./processor/text.ts";

import {
  runFastLoop,
  initiatePlanMode,
  runPlanLoop,
  planStepsToSteps,
} from "./modeEngines.ts";
import { failTask, formatTaskSummary } from "./taskConclusion.ts";
import { errorMessage, newId } from "./utils.ts";
import { createIterationFromEvent } from "./modelIterations.ts";
import { recordTaskTrace } from "./taskTrace.ts";

export type CoreEventListener = (event: CoreEvent) => void;

/** Estados de paso que una cancelación deja como fallidos (el paso ya no llegará a completarse). */
const CANCELLABLE_STEP_STATES: readonly StepState[] = ["PENDING", "RUNNING", "WAITING_APPROVAL"];

/** Motores que recibe JarvisCore; los construye la raíz de composición (server.ts). */
export type JarvisCoreDeps = Omit<EngineDependencies, "emitEvent">;

export class JarvisCore {
  private decisionEngine: EngineDependencies["decisionEngine"];
  private discoveryEngine: EngineDependencies["discoveryEngine"];
  private llm: EngineDependencies["llm"];
  private taskContexts: Map<string, TaskExecutionContext> = new Map();
  private listeners: Set<CoreEventListener> = new Set();

  constructor({ decisionEngine, discoveryEngine, llm }: JarvisCoreDeps) {
    this.decisionEngine = decisionEngine;
    this.discoveryEngine = discoveryEngine;
    this.llm = llm;
  }

  private getEngineDeps(): EngineDependencies {
    return {
      decisionEngine: this.decisionEngine,
      discoveryEngine: this.discoveryEngine,
      llm: this.llm,
      emitEvent: (taskId, type, data, stepId) => this.emitEvent(taskId, type, data, stepId),
    };
  }

  addEventListener(listener: CoreEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Refleja un evento en la tarea: limpia banderas obsoletas y guarda (o actualiza) la iteración de modelo. */
  private applyEventToTask(task: Task, event: CoreEvent): void {
    // `planConfirmed === false` significa "esperando confirmación del plan": al terminar la tarea ya no aplica.
    if (task.planConfirmed === false && isTerminalState(task.state)) {
      task.planConfirmed = undefined;
    }

    const iteration = createIterationFromEvent(event, task);
    if (!iteration) return;

    task.modelIterations = task.modelIterations || [];
    const existingIdx = task.modelIterations.findIndex((it) => it.id === iteration.id);
    if (existingIdx >= 0) {
      task.modelIterations[existingIdx] = iteration;
    } else {
      task.modelIterations.push(iteration);
    }
  }

  private emitEvent<T extends CoreEventType>(taskId: string, type: T, data: CoreEventDataMap[T], stepId?: string) {
    // Cast a CoreEvent necesario debido a la unión correlacionada (T y CoreEventDataMap[T] varían juntos)
    const event = {
      type,
      timestamp: Date.now(),
      taskId,
      stepId,
      data,
    } as CoreEvent;

    // Se aplica a la tarea antes de notificar: los listeners ven el estado ya actualizado.
    const task = this.taskContexts.get(taskId)?.task;
    if (task) this.applyEventToTask(task, event);

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("Event listener error:", err);
      }
    }
  }

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

  getAllTasks(): Task[] {
    return Array.from(this.taskContexts.values()).map((ctx) => ctx.task);
  }

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

  async initiateTask(message: string, mode: TaskMode = "NORMAL"): Promise<Task> {
    const taskId = newId("task");
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

    const context = createTaskContext(task);

    console.log(`[Task] start id=${taskId} mode=${mode}`);
    this.taskContexts.set(taskId, context);
    this.pruneTasks();
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
    if (currentStep && CANCELLABLE_STEP_STATES.includes(currentStep.state)) {
      currentStep.state = "FAILED";
      currentStep.error = "CANCELLED";
    }

    console.log(formatTaskSummary(context, "CANCELLED", "Cancelada por usuario"));
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

    let newPlan: Plan;
    try {
      newPlan = await this.llm.generatePlan(
        task.message,
        context.abortController.signal,
        { feedback, existingPlanSummary }
      );
    } catch (err) {
      if (err instanceof RequestAbortedError) return;
      // Igual que tras el éxito: si durante la generación el usuario confirmó, rechazó o canceló, el fallo ya no aplica.
      if (!this.isAwaitingPlanConfirmation(context)) return;
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

  private async runTaskPipeline(context: TaskExecutionContext): Promise<void> {
    if (context.isCancelled) return;

    const deps = this.getEngineDeps();
    if (context.task.mode === "PLAN") {
      await initiatePlanMode(context, deps);
    } else {
      await runFastLoop(context, deps);
    }
  }

  /**
   * Mantiene el tope de tareas retenidas: expulsa las terminales y, si aun así se excede, cancela la tarea en espera
   * de entrada más antigua (abandonada) hasta cumplirlo.
   */
  private pruneTasks(): void {
    this.evictTerminalTasks();

    while (this.taskContexts.size > MAX_RETAINED_TASKS) {
      const abandoned = this.findOldestWaitingTask();
      if (!abandoned) break;
      console.warn(`[JarvisCore] Tope de ${MAX_RETAINED_TASKS} tareas: se cancela la tarea en espera más antigua '${abandoned.task.id}'.`);
      this.cancelTask(abandoned.task.id);
      this.evictTerminalTasks();
    }
  }

  private findOldestWaitingTask(): TaskExecutionContext | undefined {
    for (const ctx of this.taskContexts.values()) {
      if (ctx.task.state === "WAITING_INPUT") return ctx;
    }
    return undefined;
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