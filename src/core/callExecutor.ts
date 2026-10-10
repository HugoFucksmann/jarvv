/**
 * JARVIS Core — Deterministic MCP Tool Call Executor
 */

import {
    Step,
    StepRoute,
    StepCall,
    CoreEventType,
    MAX_TOOL_CALLS_TASK,
    StepExecutionResult,
} from "./types.ts";
import { Decision20Engine } from "./decision.ts";
import { DiscoveryEngine } from "./mcp/discovery.ts";
import { Guard } from "./policy/guard.ts";
import { PolicyRegistry } from "./policy/policyRegistry.ts";
import { ILLMClient } from "./reasoner/qwen.ts";
import { ResultProcessor, ProcessedResult } from "./processor/resultProcessor.ts";
import {
    TaskExecutionContext,
    addLogEntry,
    addFailEntry,
    buildScratchpadContextForDecision,
    buildPlanLines,
} from "./context.ts";

export type EmitEventFn = (
    taskId: string,
    type: CoreEventType,
    data?: Record<string, unknown>,
    stepId?: string
) => void;

export interface EngineDependencies {
    decisionEngine: Decision20Engine;
    discoveryEngine: DiscoveryEngine;
    qwenEngine: ILLMClient;
    emitEvent: EmitEventFn;
    persistTasks: () => void;
}

export async function requestUserApproval(
    context: TaskExecutionContext,
    step: Step,
    reason: string,
    emitEvent: EmitEventFn
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
                emitEvent(context.task.id, "APPROVAL_RESOLVED", { approved: true }, step.id);
                resolve(true);
            },
            onDeny: (denyReason) => {
                context.pendingApproval = null;
                emitEvent(context.task.id, "APPROVAL_RESOLVED", { approved: false, reason: denyReason }, step.id);
                resolve(false);
            },
        };

        emitEvent(context.task.id, "APPROVAL_REQUESTED", { pendingApproval: context.pendingApproval }, step.id);
    });
}

export async function executeCall(
    context: TaskExecutionContext,
    step: Step,
    deps: EngineDependencies
): Promise<StepExecutionResult> {
    const { task } = context;

    // 1. Determine MCP Server
    let serverName = context.activeServerOverride || step.route;
    if (serverName === "fin" || serverName === "chat") {
        serverName = "desktop_commander";
    }
    context.activeServerOverride = undefined;

    const server = deps.discoveryEngine.getServer(serverName);
    if (!server) {
        throw new Error(`Servidor MCP '${serverName}' no disponible.`);
    }

    // 2. Discovery
    let discoveredTools = await deps.discoveryEngine.getDiscoveredTools(serverName);
    if (discoveredTools.length === 0) {
        throw new Error(`Discovery: No hay herramientas disponibles en '${serverName}'.`);
    }

    // Filter out excluded tool if same MCP
    if (context.excludedToolForNextCall) {
        discoveredTools = discoveredTools.filter((t) => t.name !== context.excludedToolForNextCall);
        context.excludedToolForNextCall = undefined;
    }

    // 3. Decision #2: Tool Selection
    const d2 = await deps.decisionEngine.evaluateDecisionTwo(
        step.instruction,
        discoveredTools,
        buildScratchpadContextForDecision(task)
    );

    const selectedTool = d2.selectedTool;

    // Validate tool exists in Discovery
    let exists = await deps.discoveryEngine.validateToolExists(serverName, selectedTool.name);
    if (!exists) {
        discoveredTools = await deps.discoveryEngine.getDiscoveredTools(serverName, true);
        exists = await deps.discoveryEngine.validateToolExists(serverName, selectedTool.name);
        if (!exists) {
            step.state = "FAILED";
            throw new Error(`Herramienta desconocida '${selectedTool.name}': NO EXECUTE.`);
        }
    }

    deps.emitEvent(task.id, "DECISION_TWO", {
        tool: selectedTool.name,
        confidence: d2.choiceAnswer.confidence,
        probabilities: d2.choiceAnswer.probabilities,
    }, step.id);

    // 4. Qwen Etapa 3: Argument Generation
    const cleanedSchema = deps.discoveryEngine.getCleanedSchema(serverName, selectedTool.name) || selectedTool.inputSchema;
    let args: Record<string, unknown> = {};

    try {
        args = await deps.qwenEngine.generateArguments({
            goal: task.message,
            logLines: task.memory?.log || [],
            planLines: task.mode === "PLAN" ? buildPlanLines(task) : undefined,
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
        addFailEntry(context, `${selectedTool.name} -> argumentos inválidos tras reintentos`);
        return {
            status: "logical_error",
            step,
            error: `Argumentos inválidos: ${argErr.message}`,
        };
    }

    deps.emitEvent(task.id, "ARGUMENTS_GENERATED", { args }, step.id);

    // 5. Anti-Loop Verification (§7)
    const policy = PolicyRegistry.getPolicy(serverName, selectedTool.name);
    const isRead = policy.kind === "READ";
    const isExempt = selectedTool.name === "read_process_output" || selectedTool.name === "ui_wait";

    if (!isExempt) {
        const sig = `${serverName}:${selectedTool.name}:${JSON.stringify(args)}:m${context.nonReadCounter}`;
        if (!isRead && context.executedSignatures.has(sig) && !context.lastActionWasRead) {
            context.consecutiveLoopBlocks++;
            const failMsg = `${selectedTool.name} -> ya ejecutado (anti-loop)`;
            addFailEntry(context, failMsg);
            return {
                status: "blocked_loop",
                step,
                error: "Invocación bloqueada por anti-loop (acción idéntica repetida sin lectura intermedia).",
            };
        }
        if (isRead && context.executedSignatures.has(sig)) {
            context.consecutiveLoopBlocks++;
            const failMsg = `${selectedTool.name} -> ya ejecutado (anti-loop lectura)`;
            addFailEntry(context, failMsg);
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
    deps.emitEvent(task.id, "GUARD_EVALUATION", { guardDecision }, step.id);

    if (guardDecision.decision === "DENY") {
        step.state = "BLOCKED";
        step.error = guardDecision.reason || "Operación rechazada por Guard (DENY).";
        addFailEntry(context, `${selectedTool.name} -> DENY: ${step.error}`);
        throw new Error(step.error); // Fatal: never retried
    }

    if (guardDecision.decision === "APPROVAL") {
        step.state = "WAITING_APPROVAL";
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_COMPLETED", { step }, step.id);

        const approved = await requestUserApproval(context, step, guardDecision.reason || "Operación sensible", deps.emitEvent);
        if (!approved) {
            step.state = "BLOCKED";
            step.error = "Operación rechazada por el usuario en Guard.";
            addFailEntry(context, `${selectedTool.name} -> RECHAZADO por usuario`);
            throw new Error(step.error);
        }
        step.state = "RUNNING";
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_COMPLETED", { step }, step.id);
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
    deps.emitEvent(task.id, "MCP_DISPATCHED", { mcp: serverName, tool: selectedTool.name, args }, step.id);
    const _mcpArgsTrunc = JSON.stringify(args).slice(0, 300);
    console.log(`[MCP → SEND] server=${serverName} tool=${selectedTool.name} args=${_mcpArgsTrunc}`);
    let rawResult: any;
    try {
        rawResult = await server.callTool(selectedTool.name, args);
    } catch (mcpErr: any) {
        console.error(`[MCP Call Error]`, mcpErr);
        throw mcpErr;
    }
    const _mcpResultTrunc = JSON.stringify(rawResult).slice(0, 400);
    console.log(`[MCP ← RECV] server=${serverName} tool=${selectedTool.name} result=${_mcpResultTrunc}`);

    // Windows Stale Element recovery (§6)
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

    deps.emitEvent(task.id, "MCP_RESULT", { rawResult }, step.id);

    // 9. Process Result with Extractors (§10.5)
    const processed: ProcessedResult = ResultProcessor.process(serverName, selectedTool.name, rawResult, args);
    context.lastCallCompactObs = processed.compactObs;

    // Update Scratchpad & Facts
    Object.assign(task.scratchpad, processed.scratchpadDelta);
    if (task.memory) {
        Object.assign(task.memory.facts, processed.factsDelta);
    }

    // 10. Etapa 5: Decision Evaluation
    const d5 = await deps.decisionEngine.evaluateDecisionFive(
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
    addLogEntry(context, logLine);

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

    deps.emitEvent(task.id, "RESULT_PROCESSED", { processed, d5 }, step.id);

    if (processed.verification === "UNVERIFIED") {
        return {
            status: "unverified",
            step,
            call: callRecord,
            signals: processed.signals,
        };
    }

    if (!d5.isCorrect || processed.outcome.isError) {
        addFailEntry(context, `${selectedTool.name} -> ${processed.finding}`);
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