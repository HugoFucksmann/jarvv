/**
 * JARVIS Core v1.0 — Orchestrator & Deterministic Authority
 * 
 * Invariants Enforced (§4, §51):
 * - Core controls all transitions.
 * - Models do not execute tools.
 * - Decision 2.0 only produces structured decisions according to contract.
 * - Qwen 3.5 9B does not select tools or assign capabilities.
 * - Discovery is the single source of truth for available tools.
 * - Policy Registry classifies capabilities; Guard authorizes (ALLOW, DENY, APPROVAL).
 * - APPROVAL always requires explicit human confirmation (no auto-approval).
 * - DENY cannot be bypassed by retry loops.
 * - Unknown tools are never executed (unknown tool flow: tools/list -> update cache -> re-select -> if still unknown -> NO EXECUTE).
 * - Side-effect dispatched but outcome unverified -> UNVERIFIED. No automatic retry.
 * - Strict task isolation: concurrent tasks have independent execution contexts.
 * - Global limits: MAX_STEPS = 15, MAX_TOOL_CALLS_PER_STEP = 4, MAX_PLAN_GENERATION_ATTEMPTS = 1, MAX_ARG_RETRIES = 1.
 * - Anti-loop: identical invocation signature blocks execution to prevent loops.
 * - Windows stale element recovery: detects stale element, refreshes UI tree, and attempts single recovery.
 */

import {
  Task,
  TaskState,
  Step,
  StepState,
  StepRoute,
  CoreEvent,
  CoreEventType,
  PendingApproval,
  MAX_STEPS,
  MAX_TOOL_CALLS_PER_STEP,
  MAX_ARG_RETRIES,
} from "./types.ts";
import { Decision20Engine } from "./decision.ts";
import { DiscoveryEngine } from "./mcp/discovery.ts";
import { Guard } from "./policy/guard.ts";
import { QwenEngine, ILLMClient } from "./reasoner/qwen.ts";
import { ResultProcessor } from "./processor/resultProcessor.ts";

export type CoreEventListener = (event: CoreEvent) => void;

export interface TaskExecutionContext {
  task: Task;
  isCancelled: boolean;
  pendingApproval: PendingApproval | null;
  executedSignatures: Set<string>;
  toolCallsCountPerStep: Map<string, number>;
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
    // Return first active pending approval across contexts if not specified
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
    };

    const context: TaskExecutionContext = {
      task,
      isCancelled: false,
      pendingApproval: null,
      executedSignatures: new Set(),
      toolCallsCountPerStep: new Map(),
    };

    this.taskContexts.set(taskId, context);
    this.sessionHistory.push(message);
    this.persistTasks();
    this.emitEvent(taskId, "TASK_CREATED", { task });

    // Execute pipeline independently in task context
    this.runTaskPipeline(context).catch((err) => {
      console.error(`Task ${taskId} execution error:`, err);
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
    context.task.state = "CANCELLED";
    context.pendingApproval = null;
    this.persistTasks();
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { state: "CANCELLED" });
  }

  confirmPlan(taskId: string): void {
    const context = this.taskContexts.get(taskId);
    if (!context || context.task.mode !== "PLAN") return;
    context.task.planConfirmed = true;
    this.persistTasks();
    this.emitEvent(taskId, "TASK_STATE_CHANGED", { planConfirmed: true });
    // Resume task step execution
    this.executeStepsPipeline(context);
  }

  // --- Core Execution Pipeline ---
  private async runTaskPipeline(context: TaskExecutionContext): Promise<void> {
    const { task } = context;
    if (context.isCancelled) return;

    // 1. Decision #1 — Structural Routing (§15, §16)
    let historyContext = this.sessionHistory.slice(-2);
    let d1 = await this.decisionEngine.evaluateDecisionOne(task.message, historyContext);

    // Expand context up to 5-10 messages if needed
    if (d1.needsContext && this.sessionHistory.length > 2) {
      historyContext = this.sessionHistory.slice(-5);
      d1 = await this.decisionEngine.evaluateDecisionOne(task.message, historyContext);
    }

    this.emitEvent(task.id, "DECISION_ONE", {
      route: d1.route,
      multiStep: d1.multiStep,
      needsContext: d1.needsContext,
      answers: d1.rawResponse.answers,
    });

    // 2. Determine Step Strategy
    if (task.mode === "PLAN" || d1.multiStep) {
      // Qwen 3.5 9B generates plan (MAX_PLAN_GENERATION_ATTEMPTS = 1)
      const plan = await this.qwenEngine.generatePlan(task.message, task.scratchpad);
      
      // Core validation of Plan schema (§7, §22)
      if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
        task.state = "FAILED";
        this.persistTasks();
        this.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "FAILED", error: "Plan inválido generado por Qwen 3.5 9B." });
        return;
      }

      task.steps = plan.steps.slice(0, MAX_STEPS).map((s) => ({
        id: s.id,
        route: s.route as StepRoute,
        instruction: s.instruction,
        state: "PENDING" as StepState,
      }));

      this.persistTasks();
      this.emitEvent(task.id, "PLAN_GENERATED", { steps: task.steps });

      // If mode is PLAN, pause and await user confirmation in UI (§14.2, §42)
      if (task.mode === "PLAN") {
        task.planConfirmed = false;
        return; // Execution pauses until confirmPlan() is called
      }
    } else {
      // Single step in NORMAL mode
      task.steps = [
        {
          id: "step-1",
          route: d1.route,
          instruction: task.message,
          state: "PENDING",
        },
      ];
    }

    // 3. Execute Steps
    await this.executeStepsPipeline(context);
  }

  private async executeStepsPipeline(context: TaskExecutionContext): Promise<void> {
    const { task } = context;

    for (let i = 0; i < task.steps.length; i++) {
      if (context.isCancelled) break;
      task.currentStep = i;
      const step = task.steps[i];
      step.state = "RUNNING";
      this.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex: i }, step.id);

      try {
        await this.executeStep(context, step);
      } catch (err: any) {
        step.state = "FAILED";
        step.error = err.message || String(err);
        this.persistTasks();
        this.emitEvent(task.id, "STEP_COMPLETED", { step, error: step.error }, step.id);
        break; // Stop sequence on unhandled step failure
      }

      this.persistTasks();
      this.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex: i }, step.id);
    }

    // 4. Conclude Task State
    if (!context.isCancelled) {
      const hasFailed = task.steps.some((s) => s.state === "FAILED" || s.state === "BLOCKED");
      const hasCompleted = task.steps.some((s) => s.state === "COMPLETED");
      const hasUnverified = task.steps.some((s) => s.state === "UNVERIFIED");

      let finalState: TaskState = "COMPLETED";
      if (hasFailed && hasCompleted) {
        finalState = "PARTIAL";
      } else if (hasFailed && !hasCompleted) {
        finalState = "FAILED";
      } else if (hasUnverified) {
        // If there are unverified steps, task is PARTIAL to avoid false completion (§4.12, §5.1, §36)
        finalState = "PARTIAL";
      }

      task.state = finalState;

      // Synthesize Final Response
      const evidenceList = task.steps.map((s) => s.evidence).filter(Boolean) as any[];
      try {
        task.finalResponse = await this.qwenEngine.synthesizeFinalResponse(
          task.message,
          task.steps,
          task.scratchpad,
          evidenceList
        );
      } catch (synthErr) {
        task.finalResponse = `Tarea concluida con estado ${task.state}. (No fue posible generar síntesis conversacional adicional).`;
      }

      this.persistTasks();
      this.emitEvent(task.id, "FINAL_RESPONSE", { response: task.finalResponse });
      this.emitEvent(task.id, "TASK_STATE_CHANGED", { state: task.state });
    }
  }

  private async executeStep(context: TaskExecutionContext, step: Step): Promise<void> {
    const { task } = context;

    // If route is 'chat', Qwen 3.5 9B handles directly without tool execution (§23)
    if (step.route === "chat") {
      const chatResp = await this.qwenEngine.generateChatResponse(step.instruction, task.scratchpad);
      step.state = "COMPLETED";
      step.evidence = {
        ok: true,
        summary: chatResp,
        ref: "qwen:chat",
      };
      step.verification = "VERIFIED";
      task.scratchpad.text = chatResp;
      return;
    }

    // 1. Discovery for the route's MCP server
    const serverName = step.route;
    const server = this.discoveryEngine.getServer(serverName);
    if (!server) {
      throw new Error(`Servidor MCP no disponible para la ruta '${step.route}'.`);
    }

    let discoveredTools = await this.discoveryEngine.getDiscoveredTools(step.route);
    this.emitEvent(task.id, "DISCOVERY_REFRESH", { mcp: serverName, toolCount: discoveredTools.length }, step.id);

    if (discoveredTools.length === 0) {
      throw new Error(`Discovery: No se encontraron herramientas disponibles en el servidor '${serverName}'.`);
    }

    // 2. Decision #2 — Tool Selection
    let d2 = await this.decisionEngine.evaluateDecisionTwo(
      step.instruction,
      discoveredTools,
      task.scratchpad.url || task.scratchpad.path
    );

    step.mcp = serverName;
    step.tool = d2.selectedTool.name;

    // Validate tool exists in Discovery. Unknown tool flow as per §41:
    // Unknown Tool -> tools/list -> Update Discovery Cache -> Re-select -> If still unknown -> NO EXECUTE
    let exists = await this.discoveryEngine.validateToolExists(serverName, step.tool);
    if (!exists) {
      // Refresh Discovery cache
      discoveredTools = await this.discoveryEngine.getDiscoveredTools(serverName, true);
      // Re-select tool
      d2 = await this.decisionEngine.evaluateDecisionTwo(
        step.instruction,
        discoveredTools,
        task.scratchpad.url || task.scratchpad.path
      );
      step.tool = d2.selectedTool.name;
      exists = await this.discoveryEngine.validateToolExists(serverName, step.tool);
      if (!exists) {
        step.state = "FAILED";
        throw new Error(`Herramienta desconocida '${step.tool}': NO EXECUTE como manda la política de seguridad.`);
      }
    }

    this.emitEvent(task.id, "DECISION_TWO", {
      tool: step.tool,
      confidence: d2.choiceAnswer.confidence,
      probabilities: d2.choiceAnswer.probabilities,
    }, step.id);

    // 3. Qwen 3.5 9B Argument Generation (MAX_ARG_RETRIES = 1)
    let argRetries = 0;
    let args: Record<string, unknown> = {};

    while (argRetries <= MAX_ARG_RETRIES) {
      try {
        args = await this.qwenEngine.generateArguments(step, d2.selectedTool, task.scratchpad, task.message);
        break;
      } catch (err) {
        argRetries++;
        if (argRetries > MAX_ARG_RETRIES) {
          throw new Error(`Fallo de generación de argumentos para '${step.tool}' tras límite de retries.`);
        }
      }
    }
    step.args = args;
    this.emitEvent(task.id, "ARGUMENTS_GENERATED", { args }, step.id);

    // Anti-loop operational signature check (§38):
    // Identical signature repeated within same step triggers immediate loop prevention
    const stepSig = `${step.id}:${step.mcp}:${step.tool}:${JSON.stringify(args)}`;
    if (context.executedSignatures.has(stepSig)) {
      throw new Error(
        `Detección de bucle: Invocación idéntica detectada para '${step.tool}' en el paso ${step.id}. Operación abortada por anti-loop.`
      );
    }
    context.executedSignatures.add(stepSig);

    // 4. Policy Registry & Guard Authorization (§3.9, §31, §33)
    const guardDecision = Guard.evaluate(step.mcp, step.tool, args);
    this.emitEvent(task.id, "GUARD_EVALUATION", { guardDecision }, step.id);

    if (guardDecision.decision === "DENY") {
      step.state = "BLOCKED";
      step.error = guardDecision.reason || "Operación denegada por Guard.";
      throw new Error(step.error); // Invariant: DENY cannot be bypassed by retry (§4.8)
    }

    if (guardDecision.decision === "APPROVAL") {
      // Pause and request user approval in UI (§4.7, state: WAITING_APPROVAL)
      step.state = "WAITING_APPROVAL";
      this.persistTasks();
      this.emitEvent(task.id, "STEP_COMPLETED", { step }, step.id);

      const approved = await this.requestUserApproval(context, step, guardDecision.reason || "Operación sensible");
      if (!approved) {
        step.state = "BLOCKED";
        step.error = "Operación rechazada por el usuario en Guard.";
        this.persistTasks();
        this.emitEvent(task.id, "STEP_COMPLETED", { step, error: step.error }, step.id);
        throw new Error(step.error);
      }
      step.state = "RUNNING";
      this.persistTasks();
      this.emitEvent(task.id, "STEP_COMPLETED", { step }, step.id);
    }

    // 5. Track and Enforce MAX_TOOL_CALLS_PER_STEP = 4 (§13)
    const currentCalls = (context.toolCallsCountPerStep.get(step.id) || 0) + 1;
    context.toolCallsCountPerStep.set(step.id, currentCalls);

    if (currentCalls > MAX_TOOL_CALLS_PER_STEP) {
      step.state = "FAILED";
      throw new Error(`Límite MAX_TOOL_CALLS_PER_STEP (${MAX_TOOL_CALLS_PER_STEP}) alcanzado en el paso.`);
    }

    // 6. MCP Execution
    this.emitEvent(task.id, "MCP_DISPATCHED", { mcp: step.mcp, tool: step.tool, args }, step.id);
    let rawResult = await server.callTool(step.tool, args);

    // Windows MCP Stale Element Recovery Flow (§8, §9)
    if (step.mcp === "windows" && rawResult.staleElement) {
      const callsAfterRecovery = (context.toolCallsCountPerStep.get(step.id) || 0) + 1;
      context.toolCallsCountPerStep.set(step.id, callsAfterRecovery);

      if (callsAfterRecovery <= MAX_TOOL_CALLS_PER_STEP) {
        this.emitEvent(task.id, "DISCOVERY_REFRESH", { reason: "STALE_ELEMENT_DETECTED", mcp: "windows" }, step.id);
        // Refresh UI snapshot to get valid element IDs from discovered tools dynamically (§8, §9, §15)
        const treeTool =
          discoveredTools.find((t) => /tree|snapshot|window.*tree|ui_read/i.test(t.name))?.name ||
          step.tool;
        const freshSnapshot = await server.callTool(treeTool, {});
        if (freshSnapshot.windowHandle) {
          task.scratchpad.window_handle = freshSnapshot.windowHandle as string;
        }
        // Retry action once with refreshed state
        rawResult = await server.callTool(step.tool, args);
      }
    }

    this.emitEvent(task.id, "MCP_RESULT", { rawResult }, step.id);

    // 7. Result Processor (§24, §44)
    const processed = ResultProcessor.process(step.mcp, step.tool, rawResult, args);
    step.evidence = processed.evidence;
    step.verification = processed.verification;
    step.outcome = processed.outcome;

    // Update Scratchpad
    Object.assign(task.scratchpad, processed.scratchpadDelta);
    this.emitEvent(task.id, "RESULT_PROCESSED", { processed }, step.id);

    // 8. Step State Resolution (§36)
    if (processed.verification === "UNVERIFIED") {
      // Side effect dispatched but outcome unverified -> UNVERIFIED (§4.12, §36)
      step.state = "UNVERIFIED";
    } else if (processed.outcome.success && !processed.outcome.isError) {
      step.state = "COMPLETED";
    } else {
      step.state = "FAILED";
      step.error = processed.summaryText;
      throw new Error(step.error);
    }
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

  // --- Persistence Helper ---
  private persistTasks(): void {
    try {
      if (typeof localStorage !== "undefined") {
        const serialized = Array.from(this.taskContexts.values()).map((ctx) => ctx.task);
        localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(serialized.slice(-20))); // Keep last 20 tasks
      }
    } catch (e) {
      console.warn("Failed to persist task state to localStorage:", e);
    }
  }

  private loadPersistedTasks(): void {
    try {
      if (typeof localStorage !== "undefined") {
        const stored = localStorage.getItem(TASKS_STORAGE_KEY);
        if (stored) {
          const tasks: Task[] = JSON.parse(stored);
          for (const task of tasks) {
            this.taskContexts.set(task.id, {
              task,
              isCancelled: task.state === "CANCELLED",
              pendingApproval: null,
              executedSignatures: new Set(),
              toolCallsCountPerStep: new Map(),
            });
          }
        }
      }
    } catch (e) {
      console.warn("Failed to load persisted task state:", e);
    }
  }
}
