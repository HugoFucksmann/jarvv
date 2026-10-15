/**
 * JARVIS Core — Deterministic MCP Tool Call Executor
 */

import { createHash } from "node:crypto";
import {
    isTerminalState,
    type Capability,
    type CoreEventType,
    type MCPTool,
    type Step,
    type StepCall,
    type StepExecutionResult,
    type StepHandoff,
} from "./types.ts";
import type { Decision20Engine } from "./decision.ts";
import type { DiscoveryEngine } from "./mcp/discovery.ts";
import { Guard } from "./policy/guard.ts";
import { LLMValidationError, type ILLMClient } from "./reasoner/qwen.ts";
import { RequestAbortedError } from "./llmTransport.ts";
import { ResultProcessor, type ProcessedResult } from "./processor/resultProcessor.ts";
import { resolveReferences } from "./processor/refResolver.ts";
import { applyManifest, getToolPolicy } from "./tools/manifest.ts";
import {
    type TaskExecutionContext,
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

export interface ApprovalRequest {
    mcp: string;
    tool: string;
    args: Record<string, unknown>;
    capability: Capability;
    reason: string;
}

/** Pide aprobación al usuario con los datos reales de la llamada (no los del Step, que aún no se han copiado). */
export async function requestUserApproval(
    context: TaskExecutionContext,
    step: Step,
    request: ApprovalRequest,
    emitEvent: EmitEventFn
): Promise<boolean> {
    return new Promise((resolve) => {
        context.pendingApproval = {
            id: `approval_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            stepId: step.id,
            ...request,
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

const cancelledResult = (step: Step): StepExecutionResult => ({ status: "logical_error", step, error: "CANCELLED" });

/** Huella de los argumentos para el anti-loop (evita guardar contenidos grandes en el Set). */
const argsHash = (args: Record<string, unknown>): string =>
    createHash("sha1").update(JSON.stringify(args)).digest("hex");

/**
 * Motor unificado de ejecución atómica de pasos.
 * Contrato de errores: los fallos de dominio (argumentos inválidos, anti-loop, Guard, resultado inválido) se
 * devuelven como StepExecutionResult; los fallos de infraestructura (Qwen/Decision caídos, MCP no disponible,
 * cancelación) se propagan como excepción y los decide el motor de modo.
 */
export async function runStep(
    context: TaskExecutionContext,
    step: Step,
    deps: EngineDependencies
): Promise<StepExecutionResult> {
    const { task } = context;
    const signal = context.abortController.signal;
    const isStopped = () => context.isCancelled || isTerminalState(task.state);

    if (isStopped()) return cancelledResult(step);

    // 1. Servidor MCP
    const serverName = step.route;
    const server = deps.discoveryEngine.getServer(serverName);
    if (!server) {
        throw new Error(`Servidor MCP '${serverName}' no disponible.`);
    }

    // 2. Discovery con lista cerrada: solo herramientas catalogadas en el manifest
    let discoveredTools: MCPTool[] = applyManifest(serverName, await deps.discoveryEngine.getDiscoveredTools(serverName));
    if (discoveredTools.length === 0) {
        throw new Error(`Discovery: no hay herramientas catalogadas disponibles en '${serverName}'.`);
    }

    if (context.excludedToolForNextCall) {
        const excluded = context.excludedToolForNextCall;
        context.excludedToolForNextCall = undefined;
        discoveredTools = discoveredTools.filter((t) => t.name !== excluded);
        if (discoveredTools.length === 0) {
            throw new Error(`No hay herramientas alternativas en '${serverName}' tras excluir '${excluded}'.`);
        }
    }

    // 3. Decision #2: selección de tool
    const d2 = await deps.decisionEngine.evaluateDecisionTwo(
        step.instruction,
        discoveredTools,
        buildScratchpadContextForDecision(task),
        buildAttempts(task),
        { mcp: serverName, signal }
    );
    const selectedTool = d2.selectedTool;

    let exists = await deps.discoveryEngine.validateToolExists(serverName, selectedTool.name);
    if (!exists) {
        await deps.discoveryEngine.getDiscoveredTools(serverName, true);
        exists = await deps.discoveryEngine.validateToolExists(serverName, selectedTool.name);
        if (!exists) {
            step.state = "FAILED";
            throw new Error(`Herramienta desconocida '${selectedTool.name}': NO EXECUTE.`);
        }
    }

    step.rawInput = d2.rawInput;
    step.rawOutput = d2.rawOutput;

    deps.emitEvent(task.id, "DECISION_TWO", {
        tool: selectedTool.name,
        probabilities: d2.probabilities,
        rawInput: d2.rawInput,
        rawOutput: d2.rawOutput,
    }, step.id);

    // 4. Qwen etapa 3: argumentos
    const cleanedSchema = deps.discoveryEngine.getCleanedSchema(serverName, selectedTool.name) || selectedTool.inputSchema;
    let args: Record<string, unknown>;
    let argRawInput: string;
    let argRawOutput: string;

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
            taskInstruction: applyStepHandoff(step, context),
        }, signal);
        args = argGenRes.args;
        argRawInput = argGenRes.rawInput;
        argRawOutput = argGenRes.rawOutput;
    } catch (argErr) {
        // Solo una salida inválida del modelo es un fallo lógico del paso; Qwen caído o la cancelación se propagan.
        if (!(argErr instanceof LLMValidationError)) throw argErr;
        console.error(`[Qwen Args Error]`, argErr.message);
        addFailEntry(context, `${selectedTool.name} -> argumentos inválidos tras reintentos`);
        return { status: "logical_error", step, error: `Argumentos inválidos: ${argErr.message}` };
    }

    // 4.1. Sustitución determinista de referencias {{ref:rX}} antes de Guard
    const refResolution = resolveReferences(args, task.id, selectedTool.inputSchema);
    args = refResolution.resolvedArgs;
    if (refResolution.replacedCount > 0) {
        console.log(`[runStep] Sustituidas ${refResolution.replacedCount} referencias (${refResolution.resolvedRefs.join(", ")}) desde RefStore.`);
    }

    deps.emitEvent(task.id, "ARGUMENTS_GENERATED", {
        args,
        resolvedRefs: refResolution.resolvedRefs,
        unresolvedRefs: refResolution.unresolvedRefs,
        replacedCount: refResolution.replacedCount,
        rawInput: argRawInput,
        rawOutput: argRawOutput,
    }, step.id);

    // Una referencia inexistente nunca se envía literal a la herramienta.
    if (refResolution.unresolvedRefs.length > 0) {
        const unresolved = refResolution.unresolvedRefs.join(", ");
        addFailEntry(context, `${selectedTool.name} -> referencias sin resolver: ${unresolved}`);
        return { status: "logical_error", step, error: `Referencias sin resolver: ${unresolved}` };
    }

    // 5. Anti-loop
    const policy = getToolPolicy(serverName, selectedTool.name);
    const isRead = policy.kind === "READ";

    if (!policy.loopExempt) {
        const sig = `${serverName}:${selectedTool.name}:${argsHash(args)}:m${context.nonReadCounter}`;
        // Lectura idéntica: siempre bloqueada. Acción idéntica: bloqueada si no hubo una lectura intermedia.
        if (context.executedSignatures.has(sig) && (isRead || !context.lastActionWasRead)) {
            context.consecutiveLoopBlocks++;
            addFailEntry(context, `${selectedTool.name} -> ya ejecutado (anti-loop${isRead ? " lectura" : ""})`);
            return {
                status: "blocked_loop",
                step,
                error: isRead
                    ? "Lectura idéntica bloqueada por anti-loop."
                    : "Invocación bloqueada por anti-loop (acción idéntica repetida sin lectura intermedia).",
            };
        }
        context.executedSignatures.add(sig);
    }

    // 6. Guard y aprobación
    const guardDecision = Guard.evaluate(serverName, selectedTool.name, args);
    deps.emitEvent(task.id, "GUARD_EVALUATION", { guardDecision }, step.id);

    if (guardDecision.decision === "DENY") {
        step.state = "BLOCKED";
        step.error = guardDecision.reason || "Operación rechazada por Guard (DENY).";
        addFailEntry(context, `${selectedTool.name} -> DENY: ${step.error}`);
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_COMPLETED", { step, error: step.error }, step.id);
        return { status: "logical_error", step, error: step.error, signals: { denied: true } };
    }

    if (guardDecision.decision === "APPROVAL") {
        task.state = "WAITING_INPUT";
        task.waitingReason = "approval";
        step.state = "WAITING_APPROVAL";
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_STATE_CHANGED", { step, state: "WAITING_APPROVAL" }, step.id);
        deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "WAITING_INPUT", waitingReason: "approval" });

        const approved = await requestUserApproval(context, step, {
            mcp: serverName,
            tool: selectedTool.name,
            args,
            capability: guardDecision.capability,
            reason: guardDecision.reason || "Operación sensible",
        }, deps.emitEvent);

        // La cancelación resuelve la aprobación como rechazo: no se debe revivir una tarea ya CANCELLED.
        if (isStopped()) return cancelledResult(step);

        if (!approved) {
            task.state = "RUNNING";
            task.waitingReason = undefined;
            step.state = "BLOCKED";
            step.error = "Operación rechazada por el usuario en Guard.";
            addFailEntry(context, `${selectedTool.name} -> RECHAZADO por usuario`);
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, error: step.error }, step.id);
            deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "RUNNING" });
            return { status: "logical_error", step, error: step.error, signals: { denied: true } };
        }
        task.state = "RUNNING";
        task.waitingReason = undefined;
        step.state = "RUNNING";
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_STATE_CHANGED", { step, state: "RUNNING" }, step.id);
        deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "RUNNING" });
    }

    // 7. Registro de invocación
    context.totalToolCalls++;
    if (isStopped()) return cancelledResult(step);

    // 8. Ejecución en el servidor MCP
    deps.emitEvent(task.id, "MCP_DISPATCHED", { mcp: serverName, tool: selectedTool.name, args }, step.id);
    console.log(`[MCP → SEND] server=${serverName} tool=${selectedTool.name} args=${JSON.stringify(args).slice(0, 300)}`);
    const rawResult = await server.callTool(selectedTool.name, args);
    console.log(`[MCP ← RECV] server=${serverName} tool=${selectedTool.name} result=${JSON.stringify(rawResult).slice(0, 400)}`);

    deps.emitEvent(task.id, "MCP_RESULT", { rawResult }, step.id);

    // 9. Procesamiento del resultado
    const processed: ProcessedResult = ResultProcessor.process(serverName, selectedTool.name, rawResult, args, task.id);
    context.lastCallCompactObs = processed.compactObs;
    context.lastCallTool = selectedTool.name;
    context.lastCallDecisionSummary = processed.decisionSummary;

    Object.assign(task.scratchpad, processed.scratchpadDelta);
    if (task.memory) {
        Object.assign(task.memory.facts, processed.factsDelta);
    }

    // 10. Verificación factual con Eos, solo sobre señales limpias
    const { signals } = processed;
    const isCleanSignals =
        !processed.outcome.isError &&
        !signals.exception &&
        !signals.timeout &&
        !signals.denied &&
        !signals.not_found &&
        !signals.empty_output &&
        (signals.exit_code === 0 || signals.exit_code === undefined);

    let eosPassed = false;
    let eosUnavailable = false;
    let verificationDetail: Awaited<ReturnType<Decision20Engine["evaluateStepVerification"]>> | null = null;

    if (isCleanSignals) {
        try {
            verificationDetail = await deps.decisionEngine.evaluateStepVerification(
                step.instruction,
                selectedTool.name,
                processed.decisionSummary || processed.summaryText,
                processed.evidence.summary || processed.compactObs,
                step.expectedOutcome,
                signal
            );
            eosPassed = verificationDetail.ok && verificationDetail.cumple;
        } catch (verErr) {
            if (verErr instanceof RequestAbortedError) throw verErr;
            // Sin verificador no se aprueba: el paso queda UNVERIFIED (nunca autoaprobado).
            console.warn(`[runStep] Verificación Eos no disponible; el paso queda UNVERIFIED:`, verErr instanceof Error ? verErr.message : verErr);
            eosUnavailable = true;
        }
    }

    const isStepSuccess = isCleanSignals && eosPassed;
    const verification = eosUnavailable ? "UNVERIFIED" : processed.verification;

    // LOG
    const logStatus = signals.not_found || signals.empty_output
        ? "nf"
        : eosUnavailable
            ? "unv"
            : !isStepSuccess || processed.outcome.isError
                ? "err"
                : verification === "UNVERIFIED"
                    ? "unv"
                    : "ok";
    addLogEntry(context, `${task.stepSeq}|${selectedTool.name}|${logStatus}|${processed.finding}`);

    // Estado anti-loop
    if (processed.outcome.success || verification === "UNVERIFIED" || isStepSuccess) {
        if (!isRead) {
            context.nonReadCounter++;
            context.lastActionWasRead = false;
        } else {
            context.lastActionWasRead = true;
        }
        context.consecutiveLoopBlocks = 0;
    }

    // Registro de la llamada. `evidence.ok` alimenta los intentos que ven Decision #1/#2: con Eos caído la
    // herramienta corrió limpia, así que no se marca como fallida; `outcome.success` (compuerta de `fin`) sí queda en false.
    const callRecord: StepCall = {
        id: `call_${Date.now()}`,
        mcp: serverName,
        tool: selectedTool.name,
        args,
        evidence: {
            ...processed.evidence,
            ok: eosUnavailable ? isCleanSignals : isStepSuccess,
            obs: processed.compactObs ? processed.compactObs.slice(0, 1500) : undefined,
        },
        verification,
        outcome: { ...processed.outcome, success: isStepSuccess },
        error: eosUnavailable
            ? "Verificación Eos no disponible"
            : !isStepSuccess ? processed.summaryText : undefined,
        timestamp: Date.now(),
        rawInput: argRawInput || undefined,
        rawOutput: argRawOutput || undefined,
    };

    // Efectos: toda mutación ejecutada limpiamente ocurrió en el entorno, aunque la verificación semántica falle.
    if (isCleanSignals && policy.mutates) {
        addEffectEntry(context, `${step.id}|${selectedTool.name}: ${processed.finding || processed.summaryText || 'mutación aplicada'}`);
    }

    // Handoff determinista hacia el siguiente paso (solo tras un paso exitoso)
    if (isStepSuccess) {
        const primaryFactKey = Object.keys(processed.factsDelta)[0];
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

    // Reflejo de la última llamada en el Step (compatibilidad con la UI)
    step.mcp = serverName;
    step.tool = selectedTool.name;
    step.args = args;
    step.evidence = callRecord.evidence;
    step.verification = verification;
    step.outcome = callRecord.outcome;
    if (verificationDetail) {
        step.rawInput = verificationDetail.rawInput;
        step.rawOutput = verificationDetail.rawOutput;
    }

    deps.emitEvent(task.id, "RESULT_PROCESSED", {
        processed,
        verification: verificationDetail,
        eosUnavailable,
        isStepSuccess,
        rawInput: verificationDetail?.rawInput,
        rawOutput: verificationDetail?.rawOutput,
    }, step.id);

    if (verification === "UNVERIFIED") {
        return { status: "unverified", step, call: callRecord, signals };
    }

    if (!isStepSuccess || processed.outcome.isError) {
        const reason = isCleanSignals
            ? `verificación Eos: el resultado no cumple el paso (${processed.finding || processed.summaryText})`
            : processed.finding || processed.summaryText;
        addFailEntry(context, `${selectedTool.name} -> ${reason}`);
        return { status: "logical_error", step, call: callRecord, error: processed.summaryText, signals };
    }

    return { status: "ok", step, call: callRecord, signals };
}