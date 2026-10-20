/**
 * JARVIS Core — Deterministic MCP Tool Call Executor
 */

import { createHash } from "node:crypto";
import {
    MAX_EVIDENCE_OBS_CHARS,
    isTerminalState,
    type Capability,
    type CoreEventType,
    type MCPTool,
    type Step,
    type StageVerificationResult,
    type StepCall,
    type StepExecutionResult,
    type StepHandoff,
    type VerificationState,
} from "./types.ts";
import type { Decision20Engine } from "./decision.ts";
import { cleanInputSchema, type DiscoveryEngine } from "./mcp/discovery.ts";
import { Guard } from "./policy/guard.ts";
import { LLMServiceUnavailableError, LLMValidationError, type ILLMClient } from "./reasoner/qwen.ts";
import { RequestAbortedError } from "./llmTransport.ts";
import { ResultProcessor, refLabel, sanitizeForMemory, type ProcessedResult } from "./processor/resultProcessor.ts";
import { resolveReferences } from "./processor/refResolver.ts";
import { getUserEnvironment } from "./environment.ts";
import { applyDestination, getToolPolicy, serverOf } from "./tools/manifest.ts";
import {
    type TaskExecutionContext,
    addLogEntry,
    addFailEntry,
    addEffectEntry,
    ensureMemory,
    recordDataObservation,
    buildEffectsContext,
    buildRefsContext,
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

const newCallId = (step: Step): string => `call_${step.id}_${(step.calls?.length ?? 0) + 1}_${Date.now()}`;

/**
 * Registra un intento que falló sin llegar a producir resultado (argumentos inválidos, referencias sin resolver,
 * anti-loop, Guard, excepción de infraestructura). Así Decision #1/#2 lo ven en `attempts`, `step.tool` queda
 * definido para que la escalación pueda excluir la herramienta, y `lastResult` deja de ser el de una llamada anterior.
 * Sin tool conocida solo se actualiza el resumen para Decision.
 */
export function recordFailedCall(
    context: TaskExecutionContext,
    step: Step,
    failure: { tool?: string; args?: Record<string, unknown>; error: string }
): void {
    const mcp = serverOf(step.route);
    const tool = failure.tool ?? step.tool;
    const summary = sanitizeForMemory(failure.error, 120);
    // Decision #1 solo ve herramientas y destinos: el nombre del servidor no forma parte de su vocabulario.
    context.lastCallDecisionSummary = `[FAILURE] ${tool ?? step.route}: ${summary}.`;
    if (!tool) return;

    step.calls = step.calls || [];
    step.calls.push({
        id: newCallId(step),
        mcp,
        tool,
        args: failure.args,
        evidence: { ok: false, summary },
        outcome: { success: false, isError: true },
        error: failure.error,
        timestamp: Date.now(),
    });
    step.mcp = mcp;
    step.tool = tool;
    if (failure.args) step.args = failure.args;
}

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

    // 1. Servidor MCP del destino
    const route = step.route;
    const serverName = serverOf(route);
    const server = deps.discoveryEngine.getServer(serverName);
    if (!server) {
        throw new Error(`Servidor MCP '${serverName}' no disponible.`);
    }

    // 2. Discovery con lista cerrada: solo herramientas catalogadas en el manifest que pertenecen al destino
    let discoveredTools: MCPTool[] = applyDestination(route, await deps.discoveryEngine.getDiscoveredTools(serverName));
    if (discoveredTools.length === 0) {
        const unavailable = deps.discoveryEngine.getUnavailableServers()[serverName];
        throw new Error(
            `Discovery: no hay herramientas catalogadas disponibles para el destino '${route}' en '${serverName}'` +
            (unavailable ? `: servidor no disponible (${unavailable.reason}).` : ".")
        );
    }

    if (context.excludedToolForNextCall) {
        const excluded = context.excludedToolForNextCall;
        context.excludedToolForNextCall = undefined;
        discoveredTools = discoveredTools.filter((t) => t.name !== excluded);
        if (discoveredTools.length === 0) {
            throw new Error(`No hay herramientas alternativas en el destino '${route}' tras excluir '${excluded}'.`);
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
        if (isStopped()) return cancelledResult(step);
        exists = await deps.discoveryEngine.validateToolExists(serverName, selectedTool.name);
        if (!exists) {
            step.state = "FAILED";
            throw new Error(`Herramienta desconocida '${selectedTool.name}': NO EXECUTE.`);
        }
    }

    // La herramienta elegida se refleja de inmediato: si el paso falla antes de ejecutarse, la escalación sabe cuál excluir.
    step.mcp = serverName;
    step.tool = selectedTool.name;

    deps.emitEvent(task.id, "DECISION_TWO", {
        tool: selectedTool.name,
        probabilities: d2.probabilities,
        rawInput: d2.rawInput,
        rawOutput: d2.rawOutput,
    }, step.id);

    // 4. Qwen etapa 3: argumentos
    const cleanedSchema = cleanInputSchema(selectedTool.inputSchema);
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
            refs: buildRefsContext(task),
            environment: await getUserEnvironment(),
            tool: selectedTool,
            cleanedSchema,
            dataObs: context.dataObs.map((o) => ({ stepId: o.stepId, label: o.label, obsText: o.text })),
            // La última llamada solo va aparte si no es ya la más reciente de DATA (evita enviarla dos veces).
            lastObs: context.lastCallCompactObs && context.dataObs[context.dataObs.length - 1]?.text !== context.lastCallCompactObs ? {
                stepId: context.lastCallStepId ?? step.id,
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
        const argsError = `Argumentos inválidos: ${argErr.message}`;
        recordFailedCall(context, step, { tool: selectedTool.name, error: argsError });
        return { status: "logical_error", step, error: argsError };
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
        const refError = `Referencias sin resolver: ${unresolved}`;
        recordFailedCall(context, step, { tool: selectedTool.name, args, error: refError });
        return { status: "logical_error", step, error: refError };
    }

    // 5. Anti-loop
    const policy = getToolPolicy(serverName, selectedTool.name);
    const isRead = policy.kind === "READ";

    // La firma se registra justo antes del despacho (paso 8): una llamada que nunca llegó a ejecutarse
    // (Guard, rechazo del usuario, excepción de MCP) no puede bloquear su propio reintento.
    let loopSignature: string | undefined;
    if (!policy.loopExempt) {
        const sig = `${serverName}:${selectedTool.name}:${argsHash(args)}:m${context.nonReadCounter}`;
        // Lectura idéntica: siempre bloqueada. Acción idéntica: bloqueada si no hubo una lectura intermedia.
        if (context.executedSignatures.has(sig) && (isRead || !context.lastActionWasRead)) {
            context.consecutiveLoopBlocks++;
            addFailEntry(context, `${selectedTool.name} -> ya ejecutado (anti-loop${isRead ? " lectura" : ""})`);
            const loopError = isRead
                ? "Lectura idéntica bloqueada por anti-loop."
                : "Invocación bloqueada por anti-loop (acción idéntica repetida sin lectura intermedia).";
            recordFailedCall(context, step, { tool: selectedTool.name, args, error: loopError });
            return { status: "blocked_loop", step, error: loopError };
        }
        loopSignature = sig;
    }

    // 6. Guard y aprobación
    const guardDecision = Guard.evaluate(serverName, selectedTool.name, args);
    deps.emitEvent(task.id, "GUARD_EVALUATION", { guardDecision }, step.id);

    if (guardDecision.decision === "DENY") {
        step.state = "BLOCKED";
        step.error = guardDecision.reason || "Operación rechazada por Guard (DENY).";
        addFailEntry(context, `${selectedTool.name} -> DENY: ${step.error}`);
        recordFailedCall(context, step, { tool: selectedTool.name, args, error: step.error });
        deps.emitEvent(task.id, "STEP_COMPLETED", { step, error: step.error }, step.id);
        return { status: "logical_error", step, error: step.error, signals: { denied: true } };
    }

    if (guardDecision.decision === "APPROVAL") {
        task.state = "WAITING_INPUT";
        task.waitingReason = "approval";
        step.state = "WAITING_APPROVAL";
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
            recordFailedCall(context, step, { tool: selectedTool.name, args, error: step.error });
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, error: step.error }, step.id);
            deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "RUNNING" });
            return { status: "logical_error", step, error: step.error, signals: { denied: true } };
        }
        task.state = "RUNNING";
        task.waitingReason = undefined;
        step.state = "RUNNING";
        deps.emitEvent(task.id, "STEP_STATE_CHANGED", { step, state: "RUNNING" }, step.id);
        deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "RUNNING" });
    }

    // 7. Registro de invocación
    context.totalToolCalls++;
    if (isStopped()) return cancelledResult(step);
    if (loopSignature) context.executedSignatures.add(loopSignature);

    // 8. Ejecución en el servidor MCP
    deps.emitEvent(task.id, "MCP_DISPATCHED", { mcp: serverName, tool: selectedTool.name, args }, step.id);
    console.log(`[MCP → SEND] server=${serverName} tool=${selectedTool.name} args=${JSON.stringify(args).slice(0, 300)}`);
    let rawResult: Awaited<ReturnType<typeof server.callTool>>;
    try {
        rawResult = await server.callTool(selectedTool.name, args);
    } catch (callErr) {
        // Fallo de infraestructura: la herramienta no produjo resultado, el reintento idéntico debe poder ejecutarse.
        if (loopSignature) context.executedSignatures.delete(loopSignature);
        throw callErr;
    }
    console.log(`[MCP ← RECV] server=${serverName} tool=${selectedTool.name} result=${JSON.stringify(rawResult).slice(0, 400)}`);

    // La tarea pudo cancelarse durante la llamada: un resultado tardío no toca memoria, refs ni eventos.
    if (isStopped()) {
        console.warn(`[runStep] Resultado tardío de '${selectedTool.name}' descartado: la tarea ${task.id} ya no está activa.`);
        return cancelledResult(step);
    }

    deps.emitEvent(task.id, "MCP_RESULT", { rawResult }, step.id);

    // 9. Procesamiento del resultado
    const processed: ProcessedResult = ResultProcessor.process(serverName, selectedTool.name, rawResult, args, task.id);
    context.lastCallCompactObs = processed.compactObs;
    context.lastCallTool = selectedTool.name;
    context.lastCallStepId = step.id;
    context.lastCallDecisionSummary = processed.decisionSummary;

    // Una lectura con datos se conserva aparte de la última llamada: un paso posterior (p. ej. crear un archivo con los
    // resultados de una búsqueda) la necesita aunque entre medias haya habido otras llamadas.
    if (!policy.mutates && processed.outcome.success && !processed.signals.empty_output && !processed.signals.not_found && processed.compactObs) {
        recordDataObservation(context, { stepId: step.id, label: refLabel(selectedTool.name, args), text: processed.compactObs });
    }

    // El scratchpad es solo estado visible ("lo último visto"); los facts se registran tras la verificación (más abajo).
    Object.assign(task.scratchpad, processed.scratchpadDelta);

    // 10. Verificación. Eos decide sobre señales limpias. En modo PLAN, si Eos no aprueba (rechaza o no está
    // disponible), Qwen actúa como segundo juez: el paso falla solo si fallan los dos. En FAST decide solo Eos.
    const { signals } = processed;
    const isCleanSignals =
        !processed.outcome.isError &&
        !signals.exception &&
        !signals.timeout &&
        !signals.denied &&
        !signals.not_found &&
        !signals.empty_output &&
        (signals.exit_code === 0 || signals.exit_code === undefined);

    // Etiqueta determinista de la acción ("read_file C:\x.txt"): su destino va al LOG y a Eos.
    const callLabel = refLabel(selectedTool.name, args);

    let eosPassed = false;
    let eosUnavailable = false;
    let verificationDetail: Awaited<ReturnType<Decision20Engine["evaluateStepVerification"]>> | null = null;

    if (isCleanSignals) {
        try {
            verificationDetail = await deps.decisionEngine.evaluateStepVerification(
                step.instruction,
                selectedTool.name,
                // Resultado neutro: la etiqueta [SUCCESS] de decisionSummary ya concluye por el verificador.
                `${callLabel}: ${processed.finding || processed.summaryText}`,
                processed.evidence.summary,
                step.expectedOutcome,
                // Fragmento real de lo observado. Es texto externo: se sanea y se quitan los marcadores de omisión.
                sanitizeForMemory((processed.compactObs || "").replace(/\[\.\.\.[^\]]*\]/g, "[…]"), 500),
                signal
            );
            eosPassed = verificationDetail.ok && verificationDetail.cumple;
        } catch (verErr) {
            if (verErr instanceof RequestAbortedError) throw verErr;
            console.warn(`[runStep] Verificación Eos no disponible:`, verErr instanceof Error ? verErr.message : verErr);
            eosUnavailable = true;
        }
    }

    let semantic: StageVerificationResult | undefined;
    if (isCleanSignals && !eosPassed && task.mode === "PLAN") {
        try {
            semantic = await deps.qwenEngine.verifyStage({
                goal: task.message,
                stepInstruction: step.instruction,
                expectedOutcome: step.expectedOutcome || "Cumplimiento del objetivo de la etapa",
                executedAction: `${selectedTool.name} ${JSON.stringify(args)}`,
                evidenceSummary: processed.evidence.summary || processed.evidence.obs || "",
                compactObs: processed.compactObs || "",
                facts: task.memory?.facts || {},
                logLines: task.memory?.log || [],
                effects: buildEffectsContext(task),
                failLines: task.memory?.fail || [],
            }, signal);
            deps.emitEvent(task.id, "STAGE_VERIFIED", {
                stepId: step.id,
                stageVerification: semantic,
                rawInput: semantic.rawInput,
                rawOutput: semantic.rawOutput,
            }, step.id);
            console.log(`[PLAN StageVerification] step=${step.id} status=${semantic.status} reason=${semantic.reason}`);
        } catch (semErr) {
            // Qwen caído: no hay segundo juez. Cualquier otro error (y la cancelación) se propaga.
            if (!(semErr instanceof LLMServiceUnavailableError)) throw semErr;
            console.warn(`[runStep] Verificación semántica (Qwen) no disponible:`, semErr.message);
        }
    }

    const isStepSuccess = isCleanSignals && (eosPassed || semantic?.status === "completed");
    // Sin ningún veredicto (Eos no disponible y sin segundo juez) no se aprueba ni se rechaza: queda UNVERIFIED.
    const noVerdict = eosUnavailable && !semantic;
    const verification: VerificationState = noVerdict
        ? "UNVERIFIED"
        : isStepSuccess
            ? processed.verification
            : "NOT_REQUIRED";

    // Motivo del fallo: es lo que ven el FAIL, el replan y la UI (antes solo llevaba el hallazgo, sin el porqué).
    let failReason: string | undefined;
    if (!isStepSuccess && !noVerdict) {
        const finding = processed.finding || processed.summaryText;
        if (isCleanSignals) {
            const eosNote = verificationDetail
                ? `Eos ok=${verificationDetail.okProbability.toFixed(2)} cumple=${verificationDetail.cumpleProbability.toFixed(2)}`
                : "Eos no disponible";
            const qwenNote = semantic ? ` [Qwen ${semantic.status}: ${semantic.reason}]` : "";
            failReason = sanitizeForMemory(`verificación: el resultado no cumple el paso (${finding}) [${eosNote}]${qwenNote}`, 400);
        } else {
            failReason = finding;
        }
    }

    // Los facts son "hechos confirmados": solo se registran si el paso pasó la verificación, o si no pudo verificarse
    // por falta de verificadores (la herramienta corrió limpia). Excepción: una mutación ejecutada (p. ej. el pid de un
    // proceso lanzado) describe el entorno, no una hipótesis sobre el contenido, y debe conservarse.
    if (isStepSuccess || noVerdict || policy.mutates) {
        Object.assign(ensureMemory(context).facts, processed.factsDelta);
    } else if (Object.keys(processed.factsDelta).length > 0) {
        console.log(`[runStep] Facts no confirmados descartados (${Object.keys(processed.factsDelta).join(", ")}): el paso no pasó la verificación.`);
    }

    // LOG: id del paso | acción con su destino | estado | hallazgo.
    const logStatus = signals.not_found || signals.empty_output
        ? "nf"
        : verification === "UNVERIFIED"
            ? "unv"
            : isStepSuccess
                ? "ok"
                : "err";
    addLogEntry(context, `${step.id}|${callLabel}|${logStatus}|${processed.finding}`);

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

    // Registro de la llamada. `evidence.ok` alimenta los intentos que ven Decision #1/#2: sin veredicto la
    // herramienta corrió limpia, así que no se marca como fallida; `outcome.success` (compuerta de `fin`) sí queda en false.
    const callRecord: StepCall = {
        id: newCallId(step),
        mcp: serverName,
        tool: selectedTool.name,
        args,
        evidence: {
            ...processed.evidence,
            ok: noVerdict ? isCleanSignals : isStepSuccess,
            obs: processed.compactObs ? processed.compactObs.slice(0, MAX_EVIDENCE_OBS_CHARS) : undefined,
        },
        verification,
        outcome: { ...processed.outcome, success: isStepSuccess },
        error: noVerdict ? "Verificación no disponible" : failReason,
        timestamp: Date.now(),
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

    deps.emitEvent(task.id, "RESULT_PROCESSED", {
        processed,
        verification: verificationDetail,
        eosUnavailable,
        isStepSuccess,
        verificationState: verification,
        verifiedBy: eosPassed ? "eos" : semantic?.status === "completed" ? "qwen" : undefined,
        rawInput: verificationDetail?.rawInput,
        rawOutput: verificationDetail?.rawOutput,
    }, step.id);

    if (noVerdict) {
        return { status: "unverified", step, call: callRecord, signals };
    }

    if (!isStepSuccess) {
        // Con una pregunta pendiente al usuario el fallo no es una lección para el FAIL: lo gestiona el modo PLAN.
        if (semantic?.status !== "insufficient_info") {
            addFailEntry(context, `${selectedTool.name} -> ${failReason}`);
        }
        return { status: "logical_error", step, call: callRecord, error: failReason, signals, semantic };
    }

    return { status: "ok", step, call: callRecord, signals, semantic };
}