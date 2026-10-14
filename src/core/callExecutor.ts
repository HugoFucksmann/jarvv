/**
 * JARVIS Core — Deterministic MCP Tool Call Executor
 */

import {
    Step,
    StepCall,
    CoreEventType,
    StepExecutionResult,
    isTerminalState,
    MCPTool,
    StepHandoff,
} from "./types.ts";
import { Decision20Engine } from "./decision.ts";
import { DiscoveryEngine } from "./mcp/discovery.ts";
import { Guard } from "./policy/guard.ts";
import { PolicyRegistry } from "./policy/policyRegistry.ts";
import { ILLMClient } from "./reasoner/qwen.ts";
import { ResultProcessor, ProcessedResult } from "./processor/resultProcessor.ts";
import { resolveReferences } from "./processor/refResolver.ts";
import {
    TaskExecutionContext,
    addLogEntry,
    addFailEntry,
    addEffectEntry,
    buildEffectsContext,
    applyStepHandoff,
    buildScratchpadContextForDecision,
    buildAttempts,
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

async function executeLocalTool(
    toolName: string,
    args: Record<string, unknown>,
    context: TaskExecutionContext,
    deps: EngineDependencies
): Promise<any> {
    if (toolName === "recall") {
        return {
            facts: context.task.memory?.facts || {},
            scratchpad: context.task.scratchpad || {},
            recentLog: (context.task.memory?.log || []).slice(-(context.memoryRetrievalLimit || 2)),
        };
    }
    if (toolName === "compose") {
        const textToCompose = String(args.prompt || args.text || args.content || context.task.message);
        const composedRes = await deps.qwenEngine.generateFinalResponse({
            goal: textToCompose,
            logLines: context.task.memory?.log || [],
            facts: context.task.memory?.facts || {},
            failLines: context.task.memory?.fail || [],
            evidenceSummaries: [],
        }, context.abortController.signal);
        return { composedText: composedRes.response };
    }
    if (toolName === "ask_user") {
        const question = String(args.question || args.prompt || "Por favor clarifique la solicitud.");
        context.task.state = "WAITING_INPUT";
        context.task.waitingReason = "user_answer";
        deps.persistTasks();
        deps.emitEvent(context.task.id, "TASK_STATE_CHANGED", { state: "WAITING_INPUT", waitingReason: "user_answer", question });
        return { promptSent: question, status: "waiting_user_response" };
    }
    return { status: "local_tool_executed", tool: toolName };
}

/**
 * Motor Unificado de Ejecución Atómica de Pasos (runStep)
 * Eje central de la unificación de ejecución en JARVIS Core v1.3 (§3, §3.1, §4, §5)
 */
export async function runStep(
    context: TaskExecutionContext,
    step: Step,
    deps: EngineDependencies
): Promise<StepExecutionResult> {
    const { task } = context;

    if (context.isCancelled || isTerminalState(task.state)) {
        return {
            status: "logical_error",
            step,
            error: "CANCELLED",
        };
    }

    // 1. Determine Server
    let serverName = context.activeServerOverride || step.route;
    if (serverName === "fin") {
        serverName = "desktop_commander";
    }
    context.activeServerOverride = undefined;

    // 2. Discovery
    let discoveredTools: MCPTool[];
    if (serverName === "local") {
        discoveredTools = [
            {
                name: "recall",
                description: "Recuperar hechos factuales, referencias previas o contexto relevante de memoria.",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "compose",
                description: "Redactar texto estructurado o respuesta en lenguaje natural asistido por Qwen.",
                inputSchema: { type: "object", properties: { prompt: { type: "string" } } },
            },
            {
                name: "ask_user",
                description: "Solicitar clarificación o parámetro indispensable directamente al usuario.",
                inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
            },
        ];
    } else {
        const server = deps.discoveryEngine.getServer(serverName);
        if (!server) {
            throw new Error(`Servidor MCP '${serverName}' no disponible.`);
        }
        discoveredTools = await deps.discoveryEngine.getDiscoveredTools(serverName);
        if (discoveredTools.length === 0) {
            throw new Error(`Discovery: No hay herramientas disponibles en '${serverName}'.`);
        }
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
        buildScratchpadContextForDecision(task),
        buildAttempts(task)
    );

    const selectedTool = d2.selectedTool;

    // Validate tool exists in Discovery (si no es local)
    if (serverName !== "local") {
        let exists = await deps.discoveryEngine.validateToolExists(serverName, selectedTool.name);
        if (!exists) {
            discoveredTools = await deps.discoveryEngine.getDiscoveredTools(serverName, true);
            exists = await deps.discoveryEngine.validateToolExists(serverName, selectedTool.name);
            if (!exists) {
                step.state = "FAILED";
                throw new Error(`Herramienta desconocida '${selectedTool.name}': NO EXECUTE.`);
            }
        }
    }

    step.rawInput = d2.rawInput;
    step.rawOutput = d2.rawOutput;

    deps.emitEvent(task.id, "DECISION_TWO", {
        tool: selectedTool.name,
        confidence: d2.choiceAnswer.confidence,
        probabilities: d2.choiceAnswer.probabilities,
        rawInput: d2.rawInput,
        rawOutput: d2.rawOutput,
    }, step.id);

    // 4. Qwen Etapa 3: Argument Generation
    const cleanedSchema = serverName !== "local"
        ? (deps.discoveryEngine.getCleanedSchema(serverName, selectedTool.name) || selectedTool.inputSchema)
        : (selectedTool.inputSchema || {});
    let args: Record<string, unknown> = {};
    let argRawInput = "";
    let argRawOutput = "";
    const effectiveInstruction = applyStepHandoff(step, context);

    try {
        const argGenRes = await deps.qwenEngine.generateArguments({
            goal: task.message,
            logLines: task.memory?.log || [],
            planLines: task.mode === "PLAN" ? buildPlanLines(task) : undefined,
            failLines: task.memory?.fail || [],
            facts: task.memory?.facts || {},
            effects: buildEffectsContext(task),
            tool: selectedTool,
            cleanedSchema,
            lastObs: context.lastCallCompactObs ? {
                stepIndex: task.currentStep + 1,
                toolName: context.lastCallTool || selectedTool.name,
                obsText: context.lastCallCompactObs,
            } : undefined,
            taskInstruction: effectiveInstruction,
        }, undefined, undefined, undefined, context.abortController.signal);
        args = argGenRes.args;
        argRawInput = argGenRes.rawInput;
        argRawOutput = argGenRes.rawOutput;
    } catch (argErr: any) {
        console.error(`[Qwen Args Error]`, argErr);
        addFailEntry(context, `${selectedTool.name} -> argumentos inválidos tras reintentos`);
        return {
            status: "logical_error",
            step,
            error: `Argumentos inválidos: ${argErr.message}`,
        };
    }

    // 4.1. Sustitución determinista de referencias temporales {{ref:rX}} antes de Guard (Fase 4, §3, §12 Criterio 7)
    const refResolution = resolveReferences(args, task.id);
    args = refResolution.resolvedArgs;
    if (refResolution.replacedCount > 0) {
        console.log(`[runStep] Sustituidas ${refResolution.replacedCount} referencias temporales (${refResolution.resolvedRefs.join(", ")}) desde RefStore.`);
    }

    deps.emitEvent(task.id, "ARGUMENTS_GENERATED", {
        args,
        resolvedRefs: refResolution.resolvedRefs,
        replacedCount: refResolution.replacedCount,
        rawInput: argRawInput,
        rawOutput: argRawOutput,
    }, step.id);

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

    // 6. Policy & Guard (§2, §7, §8.1 WAITING_INPUT sin timers)
    const guardDecision = Guard.evaluate(serverName, selectedTool.name, args);
    deps.emitEvent(task.id, "GUARD_EVALUATION", { guardDecision }, step.id);

    if (guardDecision.decision === "DENY") {
        step.state = "BLOCKED";
        step.error = guardDecision.reason || "Operación rechazada por Guard (DENY).";
        addFailEntry(context, `${selectedTool.name} -> DENY: ${step.error}`);
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_COMPLETED", { step, error: step.error }, step.id);
        return {
            status: "logical_error",
            step,
            error: step.error,
            signals: { denied: true },
        };
    }

    if (guardDecision.decision === "APPROVAL") {
        task.state = "WAITING_INPUT";
        task.waitingReason = "approval";
        step.state = "WAITING_APPROVAL";
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_STATE_CHANGED", { step, state: "WAITING_APPROVAL" }, step.id);
        deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "WAITING_INPUT", waitingReason: "approval" });

        const approved = await requestUserApproval(context, step, guardDecision.reason || "Operación sensible", deps.emitEvent);
        if (!approved) {
            task.state = "RUNNING";
            task.waitingReason = undefined;
            step.state = "BLOCKED";
            step.error = "Operación rechazada por el usuario en Guard.";
            addFailEntry(context, `${selectedTool.name} -> RECHAZADO por usuario`);
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, error: step.error }, step.id);
            deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "RUNNING" });
            return {
                status: "logical_error",
                step,
                error: step.error,
                signals: { denied: true },
            };
        }
        task.state = "RUNNING";
        task.waitingReason = undefined;
        step.state = "RUNNING";
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_STATE_CHANGED", { step, state: "RUNNING" }, step.id);
        deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "RUNNING" });
    }

    // 7. Registro métrico de invocación (Fase 2: límites globales erradicados)
    context.totalToolCalls++;
    if (context.isCancelled || isTerminalState(task.state)) {
        return {
            status: "logical_error",
            step,
            error: "CANCELLED",
        };
    }

    // 8. Execute Tool on Server or Local Handler
    deps.emitEvent(task.id, "MCP_DISPATCHED", { mcp: serverName, tool: selectedTool.name, args }, step.id);
    const _mcpArgsTrunc = JSON.stringify(args).slice(0, 300);
    console.log(`[MCP → SEND] server=${serverName} tool=${selectedTool.name} args=${_mcpArgsTrunc}`);
    let rawResult: any;

    if (serverName === "local") {
        rawResult = await executeLocalTool(selectedTool.name, args, context, deps);
    } else {
        const server = deps.discoveryEngine.getServer(serverName)!;
        try {
            rawResult = await server.callTool(selectedTool.name, args);
        } catch (mcpErr: any) {
            console.error(`[MCP Call Error]`, mcpErr);
            throw mcpErr;
        }
    }
    const _mcpResultTrunc = JSON.stringify(rawResult).slice(0, 400);
    console.log(`[MCP ← RECV] server=${serverName} tool=${selectedTool.name} result=${_mcpResultTrunc}`);

    // Windows Stale Element recovery (§6)
    if (serverName === "windows" && rawResult.staleElement) {
        console.log(`[Windows] Stale element detectado. Refrescando árbol...`);
        const treeTool = discoveredTools.find((t) => /tree|snapshot|window.*tree/i.test(t.name))?.name || "ui_get_window_tree";
        try {
            const server = deps.discoveryEngine.getServer("windows")!;
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

    // 9. Process Result with Extractors scoped by taskId (§10.5)
    const processed: ProcessedResult = ResultProcessor.process(
        serverName,
        selectedTool.name,
        rawResult,
        args,
        task.id
    );
    context.lastCallCompactObs = processed.compactObs;
    context.lastCallTool = selectedTool.name;
    context.lastCallDecisionSummary = processed.decisionSummary;

    // Update Scratchpad & Facts
    Object.assign(task.scratchpad, processed.scratchpadDelta);
    if (task.memory) {
        Object.assign(task.memory.facts, processed.factsDelta);
    }

    // 10. Verificación Factual con Eos sobre señales limpias (CLEAN) (Fase 3, §5)
    const isCleanSignals =
        !processed.outcome.isError &&
        !processed.signals.exception &&
        !processed.signals.timeout &&
        !processed.signals.denied &&
        !processed.signals.not_found &&
        !processed.signals.empty_output &&
        !processed.signals.stale_element &&
        (processed.signals.exit_code === 0 || processed.signals.exit_code === undefined);

    let stepVerificationOk = false;
    let stepVerificationCumple = false;
    let verificationDetail: any = null;

    if (isCleanSignals) {
        try {
            const verification = await deps.decisionEngine.evaluateStepVerification(
                step.instruction,
                selectedTool.name,
                processed.decisionSummary || processed.summaryText,
                processed.evidence?.summary || processed.compactObs,
                step.expectedOutcome
            );
            stepVerificationOk = verification.ok;
            stepVerificationCumple = verification.cumple;
            verificationDetail = verification;
        } catch (verErr: any) {
            console.warn(`[runStep] Fallo al consultar verificación Eos:`, verErr?.message || verErr);
            // Fallback determinista en ausencia del servicio Eos si las señales físicas son limpias
            stepVerificationOk = true;
            stepVerificationCumple = true;
        }
    } else {
        stepVerificationOk = false;
        stepVerificationCumple = false;
    }

    const isStepSuccess = isCleanSignals && stepVerificationOk && stepVerificationCumple;

    // Append to LOG (§10.3)
    const logStatus = processed.signals.not_found || processed.signals.empty_output
        ? "nf"
        : !isStepSuccess || processed.outcome.isError
            ? "err"
            : processed.verification === "UNVERIFIED"
                ? "unv"
                : "ok";

    const logLine = `${task.stepSeq}|${selectedTool.name}|${logStatus}|${processed.finding}`;
    addLogEntry(context, logLine);

    // Update anti-loop state trackers
    if (processed.outcome.success || processed.verification === "UNVERIFIED" || isStepSuccess) {
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
        evidence: {
            ...processed.evidence,
            ok: isStepSuccess,
            obs: processed.compactObs ? processed.compactObs.slice(0, 1500) : undefined,
        },
        verification: processed.verification,
        outcome: {
            ...processed.outcome,
            success: isStepSuccess,
        },
        error: !isStepSuccess ? processed.summaryText : undefined,
        timestamp: Date.now(),
        rawInput: argRawInput || undefined,
        rawOutput: argRawOutput || undefined,
    };

    // Registrar efectos secundarios e inyectar handoff determinista (Fase 4, §3.2.5)
    if (isStepSuccess) {
        if (policy.mutates || policy.capability !== "READ") {
            const effectDesc = `${selectedTool.name}: ${processed.finding || processed.summaryText || 'mutación aplicada'}`;
            addEffectEntry(context, `${step.id}|${effectDesc}`);
        }

        const factKeys = Object.keys(processed.factsDelta);
        const primaryFactKey = factKeys[0];
        const handoff: StepHandoff = {
            fromStepId: step.id,
            tool: selectedTool.name,
            finding: processed.finding || processed.summaryText || "Paso ejecutado con éxito",
            primaryFact: primaryFactKey ? { key: primaryFactKey, value: processed.factsDelta[primaryFactKey] } : undefined,
            refKey: processed.refKey,
            factsDelta: processed.factsDelta,
            timestamp: Date.now(),
        };
        step.handoff = handoff;
        context.lastHandoff = handoff;
    }

    step.calls = step.calls || [];
    step.calls.push(callRecord);

    // Mirror last call onto Step for UI compatibility
    step.mcp = serverName;
    step.tool = selectedTool.name;
    step.args = args;
    step.evidence = callRecord.evidence;
    step.verification = processed.verification;
    step.outcome = callRecord.outcome;
    if (verificationDetail?.rawInput) {
        step.rawInput = verificationDetail.rawInput;
        step.rawOutput = verificationDetail.rawOutput;
    }

    deps.emitEvent(task.id, "RESULT_PROCESSED", {
        processed,
        verification: verificationDetail,
        isStepSuccess,
        rawInput: verificationDetail?.rawInput,
        rawOutput: verificationDetail?.rawOutput,
    }, step.id);

    if (processed.verification === "UNVERIFIED") {
        return {
            status: "unverified",
            step,
            call: callRecord,
            signals: processed.signals,
        };
    }

    if (!isStepSuccess || processed.outcome.isError) {
        addFailEntry(context, `${selectedTool.name} -> ${processed.finding || processed.summaryText}`);
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