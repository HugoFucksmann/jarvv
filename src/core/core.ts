/**
 * JARVIS Core v2.1 — Unified Reactive Engine & Deterministic Authority
 * Implements FAST and PLAN modes over a single execution engine (§1, §4, §8, §9)
 */

import {
  Task,
  TaskState,
  Step,
  StepState,
  StepRoute,
  StepCall,
  CoreEvent,
  CoreEventType,
  PendingApproval,
  MAX_STEPS,
  MAX_TOOL_CALLS_PER_STEP,
  MAX_TOOL_CALLS_TASK,
  MAX_ESCALATIONS,
  MAX_REPLAN,
  DECISION_MIN_CONFIDENCE,
  DECISION_MIN_CONFIDENCE_POST_ACTION,
  StepExecutionResult,
  EscalationResponse,
} from "./types.ts";
import { Decision20Engine } from "./decision.ts";
import { DiscoveryEngine } from "./mcp/discovery.ts";
import { Guard } from "./policy/guard.ts";
import { PolicyRegistry } from "./policy/policyRegistry.ts";
import { QwenEngine, ILLMClient } from "./reasoner/qwen.ts";
import { ResultProcessor, RefStore, ProcessedResult } from "./processor/resultProcessor.ts";

export type CoreEventListener = (event: CoreEvent) => void;

export interface TaskExecutionContext {
  task: Task;
  abortController: AbortController;
  isCancelled: boolean;
  pendingApproval: PendingApproval | null;
  executedSignatures: Set<string>;
  nonReadCounter: number;
  lastActionWasRead: boolean;
  consecutiveLoopBlocks: number;
  totalToolCalls: number;
  escalations: number;
  startTime: number;
  overridesCount: number;
  retriesCount: number;
  activeServerOverride?: string;
  excludedToolForNextCall?: string;
  lastCallCompactObs?: string;
}

const TASKS_STORAGE_KEY = "jarvis_tasks_history_v1";

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
    // Resume plan execution
    this.runPlanLoop(context).catch((err) => {
      console.error(`[Plan Resume Error] id=${taskId}`, err);
    });
  }

  // --- Pipeline Orchestration ---
  private async runTaskPipeline(context: TaskExecutionContext): Promise<void> {
    if (context.isCancelled) return;

    if (context.task.mode === "PLAN") {
      await this.initiatePlanMode(context);
    } else {
      await this.runFastLoop(context);
    }
  }

  // ============================================================
  // FAST MODE ENGINE (§4, §8)
  // ============================================================
  private async runFastLoop(context: TaskExecutionContext): Promise<void> {
    const { task } = context;

    while (!context.isCancelled) {
      const currentStepSeq = task.stepSeq ?? 0;
      if (currentStepSeq >= MAX_STEPS) {
        console.warn(`[FAST] MAX_STEPS (${MAX_STEPS}) alcanzado. Parada controlada PARTIAL.`);
        await this.concludeTask(context, "PARTIAL", "Límite MAX_STEPS alcanzado.");
        return;
      }

      if (context.totalToolCalls >= MAX_TOOL_CALLS_TASK) {
        console.warn(`[FAST] MAX_TOOL_CALLS_TASK (${MAX_TOOL_CALLS_TASK}) alcanzado.`);
        await this.concludeTask(context, "PARTIAL", "Límite MAX_TOOL_CALLS_TASK alcanzado.");
        return;
      }

      // Step 1: Decision #1 Route
      let selectedRoute: StepRoute;
      if (context.activeServerOverride) {
        selectedRoute = context.activeServerOverride as StepRoute;
        context.activeServerOverride = undefined;
      } else {
        const isFirst = task.stepSeq === 0;
        const d1 = await this.decisionEngine.evaluateDecisionOne(
          task.message,
          this.buildHistoryContext(task),
          {
            allowFin: true,
            isPostAction: context.nonReadCounter > 0,
            isFirstIteration: isFirst,
          }
        );

        this.emitEvent(task.id, "DECISION_ONE", {
          route: d1.route,
          confidence: d1.confidence,
          probabilities: d1.probabilities,
          needsContext: d1.needsContext,
        });

        // Validation of FIN (§5)
        if (d1.route === "fin") {
          if (isFirst) {
            // Conversational query: no Step created, respond directly
            console.log(`[FAST] Conversación directa (fin inicial). Respondiendo directo.`);
            const finalResp = await this.qwenEngine.generateFinalResponse({
              goal: task.message,
              logLines: [],
              facts: task.memory?.facts || {},
              failLines: [],
              evidenceSummaries: [],
            }, context.abortController.signal);

            task.finalResponse = finalResp;
            task.state = "COMPLETED";
            this.persistTasks();
            this.emitEvent(task.id, "FINAL_RESPONSE", { response: finalResp });
            this.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "COMPLETED" });
            return;
          }

          // Validate non-initial fin: must have >= 1 successful tool call and no unverified pending
          const hasSuccessfulTool = task.steps.some((s) => s.calls && s.calls.some((c) => c.outcome?.success));
          const hasPendingUnverified = task.steps.some((s) => s.calls && s.calls.some((c) => c.verification === "UNVERIFIED"));

          if (hasSuccessfulTool && !hasPendingUnverified) {
            console.log(`[FAST] fin validado. Concluyendo con éxito.`);
            await this.concludeTask(context, "COMPLETED");
            return;
          } else {
            console.warn(`[FAST] fin rechazado por validación de Core. Redirigiendo a mejor ruta.`);
            this.addFailEntry(context, "fin rechazado: faltan acciones verificadas previas");
            selectedRoute = "desktop_commander";
          }
        } else {
          selectedRoute = d1.route;
        }
      }

      // Create Step for this iteration
      task.stepSeq = (task.stepSeq ?? 0) + 1;
      const stepIndex = task.steps.length;
      task.currentStep = stepIndex;

      const step: Step = {
        id: `s${task.stepSeq}`,
        route: selectedRoute,
        instruction: task.message,
        state: "RUNNING",
        calls: [],
        rev: 0,
        superseded: false,
      };

      task.steps.push(step);
      this.persistTasks();
      this.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);

      // Execute single call
      const execResult = await this.executeCall(context, step);

      if (execResult.status === "ok") {
        step.state = "COMPLETED";
        this.persistTasks();
        this.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
        // Continue loop to Etapa 1 with result injected into memory
      } else if (execResult.status === "unverified") {
        step.state = "UNVERIFIED";
        this.persistTasks();
        this.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
        // UNVERIFIED: lock non-READ actions for 1 iteration (§4, §6)
        console.warn(`[FAST] Acción UNVERIFIED registrada. Requiere observación.`);
      } else if (execResult.status === "blocked_loop") {
        if (context.consecutiveLoopBlocks >= 2) {
          console.warn(`[FAST] 2 bloqueos seguidos de anti-loop. Cerrando PARTIAL.`);
          step.state = "FAILED";
          step.error = "Bloqueos repetidos por anti-loop.";
          await this.concludeTask(context, "PARTIAL", "Detenido por anti-loop (2 bloqueos seguidos).");
          return;
        }
      } else {
        // Logical error -> Etapa 5B (Análisis del fallo / Escalación Qwen)
        step.state = "FAILED";
        step.error = execResult.error || "Fallo lógico en ejecución.";
        this.persistTasks();
        this.emitEvent(task.id, "STEP_COMPLETED", { step, error: step.error }, step.id);

        const shouldContinue = await this.handleEscalation(context, step, execResult);
        if (!shouldContinue) {
          return;
        }
      }
    }
  }

  // ============================================================
  // PLAN MODE ENGINE (§9)
  // ============================================================
  private async initiatePlanMode(context: TaskExecutionContext): Promise<void> {
    const { task } = context;

    // Check if prompt is direct conversation via Decision #1
    const d1Initial = await this.decisionEngine.evaluateDecisionOne(task.message, [], {
      allowFin: true,
      isFirstIteration: true,
    });

    if (d1Initial.route === "fin" && d1Initial.confidence >= DECISION_MIN_CONFIDENCE) {
      console.log(`[PLAN] Objetivo clasificado como conversación directa (fin). Respondiendo sin plan.`);
      const finalResp = await this.qwenEngine.generateFinalResponse({
        goal: task.message,
        logLines: [],
        facts: {},
        failLines: [],
        evidenceSummaries: [],
      }, context.abortController.signal);

      task.finalResponse = finalResp;
      task.state = "COMPLETED";
      this.persistTasks();
      this.emitEvent(task.id, "FINAL_RESPONSE", { response: finalResp });
      this.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "COMPLETED" });
      return;
    }

    // 1 call to Qwen to generate plan (§9.1)
    let plan;
    try {
      plan = await this.qwenEngine.generatePlan(task.message, undefined, context.abortController.signal);
    } catch (err: any) {
      task.state = "FAILED";
      this.persistTasks();
      this.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "FAILED", error: `Plan inválido: ${err.message}` });
      return;
    }

    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      task.state = "FAILED";
      this.persistTasks();
      this.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "FAILED", error: "Plan inválido en único intento." });
      return;
    }

    task.steps = plan.steps.slice(0, MAX_STEPS).map((s, idx) => ({
      id: s.id || `s${idx + 1}`,
      route: (s.suggested_mcp || "desktop_commander") as StepRoute,
      instruction: s.goal || s.instruction || "Objetivo",
      expectedOutcome: s.expected_outcome || s.expectedOutcome,
      state: "PENDING" as StepState,
      calls: [],
      rev: 0,
      superseded: false,
    }));

    task.stepSeq = task.steps.length;
    task.planConfirmed = false;
    this.persistTasks();
    this.emitEvent(task.id, "PLAN_GENERATED", { steps: task.steps });
    console.log(`[PLAN] Plan generado con ${task.steps.length} pasos. Esperando confirmación.`);
  }

  private async runPlanLoop(context: TaskExecutionContext): Promise<void> {
    const { task } = context;

    while (!context.isCancelled) {
      // Find first non-superseded PENDING/RUNNING step
      const stepIndex = task.steps.findIndex((s) => !s.superseded && (s.state === "PENDING" || s.state === "RUNNING"));
      if (stepIndex === -1) {
        // All active steps completed!
        console.log(`[PLAN] Todos los pasos completados. Concluyendo tarea.`);
        await this.concludeTask(context, "COMPLETED");
        return;
      }

      task.currentStep = stepIndex;
      const step = task.steps[stepIndex];
      step.state = "RUNNING";
      this.persistTasks();
      this.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);

      // Mini-loop FAST for this step (max MAX_TOOL_CALLS_PER_STEP = 4 calls)
      let stepCompleted = false;
      let stepCalls = 0;

      while (stepCalls < MAX_TOOL_CALLS_PER_STEP && !stepCompleted && !context.isCancelled) {
        stepCalls++;

        const execResult = await this.executeCall(context, step);

        if (execResult.status === "ok") {
          // Verify with Decision against expected_outcome (§9.3)
          if (step.expectedOutcome) {
            const extract = execResult.call?.evidence?.summary || "";
            const judgement = await this.decisionEngine.evaluatePlanJudgement(
              step.expectedOutcome,
              execResult.call?.evidence?.summary || "",
              extract
            );

            if (judgement.met) {
              stepCompleted = true;
              step.state = "COMPLETED";
              this.persistTasks();
              this.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
              break;
            } else {
              console.log(`[PLAN Judgement] Criterio no cumplido aún. Continuando mini-loop.`);
            }
          } else {
            stepCompleted = true;
            step.state = "COMPLETED";
            this.persistTasks();
            this.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
            break;
          }
        } else if (execResult.status === "unverified") {
          step.state = "UNVERIFIED";
          this.persistTasks();
          this.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
          break;
        } else if (execResult.status === "blocked_loop") {
          // Replan on loop block
          break;
        } else {
          // Logical error
          break;
        }
      }

      // If step did not complete after calls exhausted or logical error -> Replan localizado (§9.4)
      if (!stepCompleted && !context.isCancelled) {
        step.state = "FAILED";
        step.error = step.error || "Paso falló o agotó calls sin cumplir criterio.";
        this.persistTasks();
        this.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

        if ((task.replans || 0) >= MAX_REPLAN) {
          console.warn(`[PLAN] MAX_REPLAN (${MAX_REPLAN}) alcanzado.`);
          await this.concludeTask(context, "PARTIAL", "Límite de replanes alcanzado.");
          return;
        }

        const replanSuccess = await this.handleReplan(context, stepIndex);
        if (!replanSuccess) {
          return;
        }
      }
    }
  }

  // ============================================================
  // EXECUTE CALL (UNA call determinista: Etapas 2 -> 5)
  // ============================================================
  private async executeCall(context: TaskExecutionContext, step: Step): Promise<StepExecutionResult> {
    const { task } = context;

    // 1. Determine MCP Server
    let serverName = context.activeServerOverride || step.route;
    if (serverName === "fin" || serverName === "chat") {
      serverName = "desktop_commander";
    }
    context.activeServerOverride = undefined;

    const server = this.discoveryEngine.getServer(serverName);
    if (!server) {
      throw new Error(`Servidor MCP '${serverName}' no disponible.`);
    }

    // 2. Discovery
    let discoveredTools = await this.discoveryEngine.getDiscoveredTools(serverName);
    if (discoveredTools.length === 0) {
      throw new Error(`Discovery: No hay herramientas disponibles en '${serverName}'.`);
    }

    // Filter out excluded tool if same MCP
    if (context.excludedToolForNextCall) {
      discoveredTools = discoveredTools.filter((t) => t.name !== context.excludedToolForNextCall);
      context.excludedToolForNextCall = undefined;
    }

    // 3. Decision #2: Tool Selection
    const d2 = await this.decisionEngine.evaluateDecisionTwo(
      step.instruction,
      discoveredTools,
      this.buildScratchpadContextForDecision(task)
    );

    const selectedTool = d2.selectedTool;

    // Validate tool exists in Discovery
    let exists = await this.discoveryEngine.validateToolExists(serverName, selectedTool.name);
    if (!exists) {
      discoveredTools = await this.discoveryEngine.getDiscoveredTools(serverName, true);
      exists = await this.discoveryEngine.validateToolExists(serverName, selectedTool.name);
      if (!exists) {
        step.state = "FAILED";
        throw new Error(`Herramienta desconocida '${selectedTool.name}': NO EXECUTE.`);
      }
    }

    this.emitEvent(task.id, "DECISION_TWO", {
      tool: selectedTool.name,
      confidence: d2.choiceAnswer.confidence,
      probabilities: d2.choiceAnswer.probabilities,
    }, step.id);

    // 4. Qwen Etapa 3: Argument Generation
    const cleanedSchema = this.discoveryEngine.getCleanedSchema(serverName, selectedTool.name) || selectedTool.inputSchema;
    let args: Record<string, unknown> = {};

    try {
      args = await this.qwenEngine.generateArguments({
        goal: task.message,
        logLines: task.memory?.log || [],
        planLines: task.mode === "PLAN" ? this.buildPlanLines(task) : undefined,
        failLines: task.memory?.fail || [],
        facts: task.memory?.facts || {},
        tool: selectedTool,
        cleanedSchema,
        lastObs: context.lastCallCompactObs ? {
          stepIndex: task.currentStep + 1,
          toolName: selectedTool.name,
          obsText: context.lastCallCompactObs,
        } : undefined,
        taskInstruction: step.instruction,
      }, undefined, undefined, undefined, context.abortController.signal);
    } catch (argErr: any) {
      console.error(`[Qwen Args Error]`, argErr);
      this.addFailEntry(context, `${selectedTool.name} -> argumentos inválidos tras reintentos`);
      return {
        status: "logical_error",
        step,
        error: `Argumentos inválidos: ${argErr.message}`,
      };
    }

    this.emitEvent(task.id, "ARGUMENTS_GENERATED", { args }, step.id);

    // 5. Anti-Loop Verification (§7)
    const policy = PolicyRegistry.getPolicy(serverName, selectedTool.name);
    const isRead = policy.kind === "READ";
    const isExempt = selectedTool.name === "read_process_output" || selectedTool.name === "ui_wait";

    if (!isExempt) {
      const sig = `${serverName}:${selectedTool.name}:${JSON.stringify(args)}:m${context.nonReadCounter}`;
      if (!isRead && context.executedSignatures.has(sig) && !context.lastActionWasRead) {
        context.consecutiveLoopBlocks++;
        const failMsg = `${selectedTool.name} -> ya ejecutado (anti-loop)`;
        this.addFailEntry(context, failMsg);
        return {
          status: "blocked_loop",
          step,
          error: "Invocación bloqueada por anti-loop (acción idéntica repetida sin lectura intermedia).",
        };
      }
      if (isRead && context.executedSignatures.has(sig)) {
        context.consecutiveLoopBlocks++;
        const failMsg = `${selectedTool.name} -> ya ejecutado (anti-loop lectura)`;
        this.addFailEntry(context, failMsg);
        return {
          status: "blocked_loop",
          step,
          error: "Lectura idéntica bloqueada por anti-loop.",
        };
      }
      context.executedSignatures.add(sig);
    }

    // 6. Policy & Guard (§2, §7)
    const guardDecision = Guard.evaluate(serverName, selectedTool.name, args);
    this.emitEvent(task.id, "GUARD_EVALUATION", { guardDecision }, step.id);

    if (guardDecision.decision === "DENY") {
      step.state = "BLOCKED";
      step.error = guardDecision.reason || "Operación rechazada por Guard (DENY).";
      this.addFailEntry(context, `${selectedTool.name} -> DENY: ${step.error}`);
      throw new Error(step.error); // Fatal: never retried
    }

    if (guardDecision.decision === "APPROVAL") {
      step.state = "WAITING_APPROVAL";
      this.persistTasks();
      this.emitEvent(task.id, "STEP_COMPLETED", { step }, step.id);

      const approved = await this.requestUserApproval(context, step, guardDecision.reason || "Operación sensible");
      if (!approved) {
        step.state = "BLOCKED";
        step.error = "Operación rechazada por el usuario en Guard.";
        this.addFailEntry(context, `${selectedTool.name} -> RECHAZADO por usuario`);
        throw new Error(step.error);
      }
      step.state = "RUNNING";
      this.persistTasks();
      this.emitEvent(task.id, "STEP_COMPLETED", { step }, step.id);
    }

    // 7. Enforce MAX_TOOL_CALLS_TASK
    context.totalToolCalls++;
    if (context.totalToolCalls > MAX_TOOL_CALLS_TASK) {
      step.state = "FAILED";
      step.error = `Tope global MAX_TOOL_CALLS_TASK (${MAX_TOOL_CALLS_TASK}) alcanzado.`;
      return {
        status: "logical_error",
        step,
        error: step.error,
      };
    }

    // 8. Execute Tool on Server
    this.emitEvent(task.id, "MCP_DISPATCHED", { mcp: serverName, tool: selectedTool.name, args }, step.id);
    // Diagnostic log: MCP tool name and args sent
    const _mcpArgsTrunc = JSON.stringify(args).slice(0, 300);
    console.log(`[MCP → SEND] server=${serverName} tool=${selectedTool.name} args=${_mcpArgsTrunc}`);
    let rawResult: any;
    try {
      rawResult = await server.callTool(selectedTool.name, args);
    } catch (mcpErr: any) {
      console.error(`[MCP Call Error]`, mcpErr);
      throw mcpErr;
    }
    // Diagnostic log: MCP result received
    const _mcpResultTrunc = JSON.stringify(rawResult).slice(0, 400);
    console.log(`[MCP ← RECV] server=${serverName} tool=${selectedTool.name} result=${_mcpResultTrunc}`);

    // Windows Stale Element recovery (§6, keep current behavior core.ts:465-482)
    if (serverName === "windows" && rawResult.staleElement) {
      console.log(`[Windows] Stale element detectado. Refrescando árbol...`);
      const treeTool = discoveredTools.find((t) => /tree|snapshot|window.*tree/i.test(t.name))?.name || "ui_get_window_tree";
      try {
        const fresh = await server.callTool(treeTool, {});
        if (fresh.windowHandle) {
          task.scratchpad.window_handle = String(fresh.windowHandle);
        }
        context.retriesCount++;
        rawResult = await server.callTool(selectedTool.name, args);
      } catch (retryErr) {
        console.warn(`[Windows Stale Retry Error]`, retryErr);
      }
    }

    this.emitEvent(task.id, "MCP_RESULT", { rawResult }, step.id);

    // 9. Process Result with Extractors (§10.5)
    const processed: ProcessedResult = ResultProcessor.process(serverName, selectedTool.name, rawResult, args);
    context.lastCallCompactObs = processed.compactObs;

    // Update Scratchpad & Facts
    Object.assign(task.scratchpad, processed.scratchpadDelta);
    if (task.memory) {
      Object.assign(task.memory.facts, processed.factsDelta);
    }

    // 10. Etapa 5: Decision Evaluation
    const d5 = await this.decisionEngine.evaluateDecisionFive(
      step.instruction,
      selectedTool.name,
      processed.summaryText,
      processed.signals
    );
    if (d5.override) {
      context.overridesCount++;
    }

    // Append to LOG (§10.3)
    const logStatus = processed.signals.not_found || processed.signals.empty_output
      ? "nf"
      : !d5.isCorrect || processed.outcome.isError
      ? "err"
      : processed.verification === "UNVERIFIED"
      ? "unv"
      : "ok";

    const logLine = `${task.stepSeq}|${selectedTool.name}|${logStatus}|${processed.finding}`;
    this.addLogEntry(context, logLine);

    // Update anti-loop state trackers
    if (processed.outcome.success || processed.verification === "UNVERIFIED") {
      if (!isRead) {
        context.nonReadCounter++;
        context.lastActionWasRead = false;
      } else {
        context.lastActionWasRead = true;
      }
      context.consecutiveLoopBlocks = 0;
    }

    // Record Call on Step
    const callRecord: StepCall = {
      id: `call_${Date.now()}`,
      mcp: serverName,
      tool: selectedTool.name,
      args,
      evidence: processed.evidence,
      verification: processed.verification,
      outcome: processed.outcome,
      error: !d5.isCorrect ? processed.summaryText : undefined,
      timestamp: Date.now(),
    };

    step.calls = step.calls || [];
    step.calls.push(callRecord);

    // Mirror last call onto Step for UI compatibility
    step.mcp = serverName;
    step.tool = selectedTool.name;
    step.args = args;
    step.evidence = processed.evidence;
    step.verification = processed.verification;
    step.outcome = processed.outcome;

    this.emitEvent(task.id, "RESULT_PROCESSED", { processed, d5 }, step.id);

    if (processed.verification === "UNVERIFIED") {
      return {
        status: "unverified",
        step,
        call: callRecord,
        signals: processed.signals,
      };
    }

    if (!d5.isCorrect || processed.outcome.isError) {
      this.addFailEntry(context, `${selectedTool.name} -> ${processed.finding}`);
      return {
        status: "logical_error",
        step,
        call: callRecord,
        error: processed.summaryText,
        signals: processed.signals,
      };
    }

    return {
      status: "ok",
      step,
      call: callRecord,
      signals: processed.signals,
    };
  }

  // ============================================================
  // ESCALATION & REPLAN (§4, §5B, §9.4)
  // ============================================================
  private async handleEscalation(
    context: TaskExecutionContext,
    step: Step,
    execResult: StepExecutionResult
  ): Promise<boolean> {
    const { task } = context;

    if (context.escalations >= MAX_ESCALATIONS) {
      console.warn(`[Escalation] MAX_ESCALATIONS (${MAX_ESCALATIONS}) agotado.`);
      const hasCompleted = task.steps.some((s) => s.state === "COMPLETED");
      await this.concludeTask(context, hasCompleted ? "PARTIAL" : "FAILED", "Tope de escalaciones agotado.");
      return false;
    }

    context.escalations++;
    console.log(`[Escalation] Activando Etapa 5B (${context.escalations}/${MAX_ESCALATIONS}).`);

    const escResp: EscalationResponse = await this.qwenEngine.escalate({
      goal: task.message,
      logLines: task.memory?.log || [],
      failLines: task.memory?.fail || [],
      facts: task.memory?.facts || {},
      failedAction: `${step.tool || step.route}`,
      errorMessage: execResult.error || "Fallo en ejecución",
      lastObs: context.lastCallCompactObs,
    }, context.abortController.signal);

    if (escResp.action === "abort") {
      console.log(`[Escalation] Qwen decidió abortar: ${escResp.reason}`);
      const hasCompleted = task.steps.some((s) => s.state === "COMPLETED");
      await this.concludeTask(context, hasCompleted ? "PARTIAL" : "FAILED", escResp.reason);
      return false;
    }

    if (escResp.action === "switch_mcp" && escResp.mcp) {
      const targetMcp = escResp.mcp.toLowerCase();
      console.log(`[Escalation] Qwen solicitó switch_mcp a '${targetMcp}'. Razón: ${escResp.reason}`);
      context.activeServerOverride = targetMcp;
      if (targetMcp === step.mcp && step.tool) {
        context.excludedToolForNextCall = step.tool;
      }
      return true;
    }

    return false;
  }

  private async handleReplan(context: TaskExecutionContext, failedStepIndex: number): Promise<boolean> {
    const { task } = context;
    task.replans = (task.replans || 0) + 1;

    const failedStep = task.steps[failedStepIndex];
    console.log(`[PLAN] Activando Replan localizado (${task.replans}/${MAX_REPLAN}) para paso '${failedStep.id}'.`);

    const completedSummary = task.steps
      .slice(0, failedStepIndex)
      .filter((s) => s.state === "COMPLETED")
      .map((s) => `[x] ${s.id} ${s.instruction} -> ${s.evidence?.summary || 'ok'}`);

    const remainingGoals = task.steps
      .slice(failedStepIndex + 1)
      .map((s) => `[ ] ${s.id} ${s.instruction}`);

    const nextIdNum = (task.stepSeq ?? 0) + 1;

    const replanResult = await this.qwenEngine.replan({
      goal: task.message,
      completedStepsSummary: completedSummary,
      facts: task.memory?.facts || {},
      failLines: task.memory?.fail || [],
      failedStepGoal: failedStep.instruction,
      failedStepResult: failedStep.error || "error",
      remainingPlanGoals: remainingGoals,
      nextStepNumber: nextIdNum,
    }, context.abortController.signal);

    if (replanResult.action === "abort" || !replanResult.plan) {
      console.log(`[PLAN Replan] Replan devolvió abort: ${replanResult.reason}`);
      const hasCompleted = task.steps.some((s) => s.state === "COMPLETED");
      await this.concludeTask(context, hasCompleted ? "PARTIAL" : "FAILED", replanResult.reason || "Replan abortado.");
      return false;
    }

    // Supersede failed step and all subsequent steps
    for (let i = failedStepIndex; i < task.steps.length; i++) {
      task.steps[i].superseded = true;
    }

    const newRev = (failedStep.rev || 0) + 1;
    const newSteps: Step[] = replanResult.plan.steps.map((s, idx) => ({
      id: s.id || `s${nextIdNum + idx}`,
      route: (s.suggested_mcp || "desktop_commander") as StepRoute,
      instruction: s.goal || s.instruction || "Meta",
      expectedOutcome: s.expected_outcome || s.expectedOutcome,
      state: "PENDING" as StepState,
      calls: [],
      rev: newRev,
      superseded: false,
    }));

    task.steps.push(...newSteps);
    task.stepSeq = (task.stepSeq ?? 0) + newSteps.length;
    this.persistTasks();
    this.emitEvent(task.id, "PLAN_GENERATED", { steps: task.steps });
    console.log(`[PLAN] Replan completado. ${newSteps.length} pasos nuevos agregados.`);
    return true;
  }

  // ============================================================
  // CONCLUSION & FINAL RESPONSE (§4, §5, Etapa 6)
  // ============================================================
  private async concludeTask(
    context: TaskExecutionContext,
    state: TaskState,
    abortReason?: string
  ): Promise<void> {
    const { task } = context;
    task.state = state;

    // Collect last 3 compacted observations from refStore or evidence
    const lastCalls = task.steps
      .flatMap((s) => s.calls || [])
      .filter((c) => c.evidence?.summary)
      .slice(-3);
    const evidenceSummaries = lastCalls.map((c) => `${c.tool}: ${c.evidence?.summary || ''}`);

    try {
      task.finalResponse = await this.qwenEngine.generateFinalResponse({
        goal: task.message,
        logLines: task.memory?.log || [],
        facts: task.memory?.facts || {},
        failLines: task.memory?.fail || [],
        evidenceSummaries,
        abortReason,
      }, context.abortController.signal);
    } catch {
      task.finalResponse = `Tarea concluida con estado ${state}.${abortReason ? ` Motivo: ${abortReason}` : ""}`;
    }

    RefStore.clear();
    this.persistTasks();
    const durationTotalMs = Date.now() - context.startTime;
    console.log(
      `[Task Summary] id=${task.id} state=${state} reason="${abortReason || 'None'}" calls=${context.totalToolCalls} escalations=${context.escalations} overrides=${context.overridesCount} retries=${context.retriesCount} duration=${durationTotalMs}ms`
    );
    this.emitEvent(task.id, "FINAL_RESPONSE", { response: task.finalResponse });
    this.emitEvent(task.id, "TASK_STATE_CHANGED", { state, finalResponse: task.finalResponse });
  }

  // ============================================================
  // HELPERS (Memory, Approval, Persistence)
  // ============================================================
  private addLogEntry(context: TaskExecutionContext, line: string): void {
    if (!context.task.memory) {
      context.task.memory = { log: [], facts: {}, fail: [] };
    }
    const log = context.task.memory.log;
    log.push(line);
    // Collapse older lines if > 12 lines (§10.3)
    if (log.length > 12) {
      const old = log.slice(0, log.length - 6);
      const okCount = old.filter((l) => l.includes("|ok|")).length;
      const errCount = old.length - okCount;
      const summaryLine = `1-${old.length}: ${okCount} ok, ${errCount} err`;
      context.task.memory.log = [summaryLine, ...log.slice(-6)];
    }
  }

  private addFailEntry(context: TaskExecutionContext, line: string): void {
    if (!context.task.memory) {
      context.task.memory = { log: [], facts: {}, fail: [] };
    }
    const fail = context.task.memory.fail;
    fail.push(line);
    if (fail.length > 5) {
      context.task.memory.fail = fail.slice(-5);
    }
  }

  private buildHistoryContext(task: Task): string {
    const logLines = task.memory?.log || [];
    const failLines = task.memory?.fail || [];
    const historyParts: string[] = [];
    if (logLines.length > 0) {
      historyParts.push(logLines.slice(-3).join("\n"));
    }
    if (failLines.length > 0) {
      historyParts.push(`FAIL:\n${failLines.slice(-2).join("\n")}`);
    }
    return historyParts.join("\n") || task.message;
  }

  private buildScratchpadContextForDecision(task: Task): string {
    const facts = task.memory?.facts || {};
    const factsStr = Object.entries(facts).map(([k, v]) => `${k}=${v}`).join(" ");
    const failLines = (task.memory?.fail || []).slice(-2).join("; ");
    return `FACTS: ${factsStr} | FAIL: ${failLines}`;
  }

  private buildPlanLines(task: Task): string[] {
    return task.steps
      .filter((s) => !s.superseded)
      .map((s) => {
        if (s.state === "COMPLETED") {
          return `[x] ${s.id} ${s.instruction} -> ${s.evidence?.summary || 'ok'}`;
        }
        if (s.state === "RUNNING") {
          return `[>] ${s.id} ${s.instruction} | éxito: ${s.expectedOutcome || 'completado'}`;
        }
        return `[ ] ${s.id} ${s.instruction}`;
      });
  }

  private requestUserApproval(
    context: TaskExecutionContext,
    step: Step,
    reason: string
  ): Promise<boolean> {
    return new Promise((resolve) => {
      context.pendingApproval = {
        id: `approval_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        stepId: step.id,
        mcp: step.mcp!,
        tool: step.tool!,
        capability: Guard.evaluate(step.mcp!, step.tool!, step.args).capability,
        args: step.args || {},
        reason,
        onApprove: () => {
          context.pendingApproval = null;
          this.emitEvent(context.task.id, "APPROVAL_RESOLVED", { approved: true }, step.id);
          resolve(true);
        },
        onDeny: (denyReason) => {
          context.pendingApproval = null;
          this.emitEvent(context.task.id, "APPROVAL_RESOLVED", { approved: false, reason: denyReason }, step.id);
          resolve(false);
        },
      };

      this.emitEvent(context.task.id, "APPROVAL_REQUESTED", { pendingApproval: context.pendingApproval }, step.id);
    });
  }

  private persistTasks(): void {
    try {
      if (typeof localStorage !== "undefined") {
        const serialized = Array.from(this.taskContexts.values()).map((ctx) => ctx.task);
        localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(serialized.slice(-20)));
      }
    } catch (e) {
      console.warn("Failed to persist task state:", e);
    }
  }

  private loadPersistedTasks(): void {
    try {
      if (typeof localStorage !== "undefined") {
        const stored = localStorage.getItem(TASKS_STORAGE_KEY);
        if (stored) {
          const tasks: Task[] = JSON.parse(stored);
          for (const task of tasks) {
            task.memory = task.memory || { log: [], facts: {}, fail: [] };
            task.replans = task.replans ?? 0;
            task.escalations = task.escalations ?? 0;
            task.stepSeq = task.stepSeq ?? task.steps.length;
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
      console.warn("Failed to load persisted task state:", e);
    }
  }
}
