/**
 * JARVIS Core — Deterministic MCP Tool Call Executor
 */

import { createHash } from "node:crypto";
import {
    MAX_EVIDENCE_OBS_CHARS,
    type CallFailureStatus,
    type Capability,
    type ExecutedCallStatus,
    type McpServerName,
    type MCPTool,
    type Step,
    type StageVerificationResult,
    type StepCall,
    type StepExecutionResult,
    type StepExecutionSignals,
    type TimeSpan,
    type StepHandoff,
    type ToolPolicy,
    type VerificationState,
} from "./types.ts";
import type { StepVerificationResult } from "./decision.ts";
import type { EmitEventFn, EngineDependencies } from "./engineDeps.ts";
import { emitStepError, emitStepStateChanged } from "./stepEvents.ts";
import { cleanInputSchema, type DiscoveryEngine } from "./mcp/discovery.ts";
import { Guard } from "./policy/guard.ts";
import {
    LLMServiceUnavailableError,
    LLMValidationError,
    type ArgumentsGenerationResult,
    type FailedAttempt,
} from "./reasoner/qwen.ts";
import { RequestAbortedError } from "./llmTransport.ts";
import { ResultProcessor, type ProcessedResult } from "./processor/resultProcessor.ts";
import { refLabel } from "./processor/refStore.ts";
import { sanitizeForMemory } from "./processor/text.ts";
import { resolveReferences } from "./processor/refResolver.ts";
import { getUserEnvironment } from "./environment.ts";
import { errorMessage, newId } from "./utils.ts";
import { applyDestination, getToolPolicy, requirementOf, serverOf } from "./tools/manifest.ts";
import {
    type TaskExecutionContext,
    addLogEntry,
    describeFailure,
    ensureMemory,
    isStopped,
    recordDataObservation,
    recordFailure,
    buildEffectsContext,
    buildRefsContext,
    applyStepHandoff,
    buildDecisionMemory,
    buildAttempts,
    buildPlanLines,
} from "./context.ts";

// Los contratos viven en engineDeps.ts; se reexportan para no romper a quien los importa desde el ejecutor.
export type { EmitEventFn, EngineDependencies } from "./engineDeps.ts";

interface ApprovalRequest {
    mcp: string;
    tool: string;
    args: Record<string, unknown>;
    capability: Capability;
    reason: string;
}

/** Pide aprobación al usuario con los datos reales de la llamada (no los del Step, que aún no se han copiado). */
function requestUserApproval(
    context: TaskExecutionContext,
    step: Step,
    request: ApprovalRequest,
    emitEvent: EmitEventFn
): Promise<boolean> {
    return new Promise((resolve) => {
        context.pendingApproval = {
            id: newId("approval"),
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

/** Única derivación del resultado de una llamada ejecutada. */
function classifyCall(c: { clean: boolean; passed: boolean; noVerdict: boolean; signals: StepExecutionSignals }): ExecutedCallStatus {
    if (c.passed) return "ok";
    if (c.noVerdict) return "unverified";   // corrió limpia y no hubo ningún veredicto
    if (c.clean) return "rejected";         // corrió limpia y ningún verificador la aprobó
    if (c.signals.not_found) return "not_found";   // el recurso no existe (ENOENT, [NOT_FOUND]…)
    if (c.signals.empty_output) return "no_data";  // existe, pero no hay datos (archivo vacío, búsqueda sin resultados)
    return "tool_error";
}

/** Token del estado en el LOG (`paso|acción|estado|hallazgo`). */
const LOG_TOKEN: Record<ExecutedCallStatus, string> = {
    ok: "ok",
    unverified: "unv",
    rejected: "rej",
    tool_error: "err",
    not_found: "nf",
    no_data: "nd",
};

/**
 * Registra un intento que falló sin producir resultado (argumentos inválidos, referencias sin resolver, anti-loop,
 * Guard, excepción) y escribe su línea de FAIL. La llamada queda en `step.calls` para que Decision #1/#2 la vean en
 * `attempts`, y `step.tool` queda definido para que la escalación pueda excluir la herramienta. Sin tool conocida
 * solo se actualizan el resumen para Decision y el FAIL.
 */
export function recordFailedCall(
    context: TaskExecutionContext,
    step: Step,
    failure: { status: CallFailureStatus; tool?: string; args?: Record<string, unknown>; error: string }
): void {
    context.lastHandoff = undefined;
    const mcp = serverOf(step.route);
    const tool = failure.tool ?? step.tool;
    const summary = sanitizeForMemory(failure.error, 120);
    // Decision #1 solo ve herramientas y destinos: el nombre del servidor no forma parte de su vocabulario.
    context.lastCallDecisionSummary = `[FAILURE] ${tool ?? step.route}: ${summary}.`;
    recordFailure(context, failure.status, { stepId: step.id, subject: tool ?? step.route });
    if (!tool) return;

    step.calls = step.calls || [];
    step.calls.push({
        id: newCallId(step),
        mcp,
        tool,
        args: failure.args,
        status: failure.status,
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

/** Datos de la ejecución en curso que comparten todas las fases de `runStep`. */
interface StepRun {
    readonly context: TaskExecutionContext;
    readonly step: Step;
    readonly deps: EngineDependencies;
    readonly signal: AbortSignal;
}

/** Resultado de una fase: continuar con un valor, o detener `runStep` con un resultado ya construido. */
type Phase<T> =
    | { readonly proceed: true; readonly value: T }
    | { readonly proceed: false; readonly result: StepExecutionResult };

const proceed = <T>(value: T): Phase<T> => ({ proceed: true, value });
const halt = (result: StepExecutionResult): Phase<never> => ({ proceed: false, result });

type McpServer = NonNullable<ReturnType<DiscoveryEngine["getServer"]>>;
type McpCallOutput = Awaited<ReturnType<McpServer["callTool"]>>;

// ---------------------------------------------------------------
// Fase 1-2: herramientas candidatas y selección (Decision #2)
// ---------------------------------------------------------------

interface CandidateTools {
    serverName: McpServerName;
    server: McpServer;
    tools: MCPTool[];
}

/**
 * Servidor MCP del destino y sus herramientas utilizables. Discovery con lista cerrada: solo las catalogadas en el
 * manifest bajo este destino, sin la excluida por la escalación y solo las que el estado de la tarea permite.
 */
async function discoverCandidateTools({ context, step, deps }: StepRun): Promise<CandidateTools> {
    const { task } = context;
    const route = step.route;
    const serverName = serverOf(route);
    const server = deps.discoveryEngine.getServer(serverName);
    if (!server) {
        throw new Error(`Servidor MCP '${serverName}' no disponible.`);
    }

    let tools: MCPTool[] = applyDestination(route, await deps.discoveryEngine.getDiscoveredTools(serverName));
    if (tools.length === 0) {
        const unavailable = deps.discoveryEngine.getUnavailableServers()[serverName];
        throw new Error(
            `Discovery: no hay herramientas catalogadas disponibles para el destino '${route}' en '${serverName}'` +
            (unavailable ? `: servidor no disponible (${unavailable.reason}).` : ".")
        );
    }

    if (context.excludedToolForNextCall) {
        const excluded = context.excludedToolForNextCall;
        context.excludedToolForNextCall = undefined;
        tools = tools.filter((t) => t.name !== excluded);
        if (tools.length === 0) {
            throw new Error(`No hay herramientas alternativas en el destino '${route}' tras excluir '${excluded}'.`);
        }
    }

    const active = {
        process: Boolean(task.scratchpad.process_id),
        search: task.steps.some((s) => s.calls?.some((c) => c.tool === "start_search" && c.outcome?.success === true)),
    };
    tools = tools.filter((t) => {
        const required = requirementOf(serverName, t.name);
        return !required || active[required];
    });
    if (tools.length === 0) {
        throw new Error(`No hay herramientas utilizables en el destino '${route}': requieren un proceso o una búsqueda activos.`);
    }

    return { serverName, server, tools };
}

/**
 * Decision #2 elige la herramienta y se confirma que el servidor la sigue exponiendo. Devuelve null si la tarea se
 * detuvo durante esa validación.
 */
async function selectTool(run: StepRun, serverName: McpServerName, tools: MCPTool[]): Promise<MCPTool | null> {
    const { context, step, deps, signal } = run;
    const { task } = context;

    const decisionMemory = buildDecisionMemory(task);
    const d2 = await deps.decisionEngine.evaluateDecisionTwo(
        step.instruction,
        tools,
        decisionMemory,
        buildAttempts(task),
        { mcp: serverName, signal }
    );
    const selectedTool = d2.selectedTool;

    let exists = await deps.discoveryEngine.validateToolExists(serverName, selectedTool.name);
    if (!exists) {
        await deps.discoveryEngine.getDiscoveredTools(serverName, true);
        if (isStopped(context)) return null;
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
        candidates: tools.map((t) => t.name),
        memory: decisionMemory,
        probabilities: d2.probabilities,
        rawInput: d2.rawInput,
        rawOutput: d2.rawOutput,
        shortcut: d2.shortcut === true,
        timing: d2.timing,
    }, step.id);

    return selectedTool;
}

// ---------------------------------------------------------------
// Fase 3: argumentos (Qwen) y referencias
// ---------------------------------------------------------------

function emitFailedArguments({ context, step, deps }: StepRun, attempts: readonly FailedAttempt[]): void {
    attempts.forEach((a, i) => deps.emitEvent(context.task.id, "ARGUMENTS_GENERATED", {
        error: a.error,
        rawInput: a.rawInput,
        rawOutput: a.rawOutput,
        attempt: i + 1,
        timing: a.timing,
    }, step.id));
}

/** La última llamada solo va aparte si no es ya la más reciente de DATA (evita enviarla dos veces). */
function lastObservationFor(context: TaskExecutionContext, step: Step, tool: MCPTool) {
    const lastObs = context.lastCallCompactObs;
    if (!lastObs || context.dataObs[context.dataObs.length - 1]?.text === lastObs) return undefined;
    return {
        stepId: context.lastCallStepId ?? step.id,
        toolName: context.lastCallTool || tool.name,
        obsText: lastObs,
    };
}

/**
 * Qwen genera los argumentos y las referencias `{{ref:rX}}` se sustituyen de forma determinista antes de Guard.
 * Solo una salida inválida del modelo es un fallo lógico del paso; Qwen caído o la cancelación se propagan.
 */
async function generateStepArguments(run: StepRun, selectedTool: MCPTool): Promise<Phase<Record<string, unknown>>> {
    const { context, step, deps, signal } = run;
    const { task } = context;
    const cleanedSchema = cleanInputSchema(selectedTool.inputSchema);

    let generated: ArgumentsGenerationResult;
    try {
        generated = await deps.qwenEngine.generateArguments({
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
            lastObs: lastObservationFor(context, step, selectedTool),
            taskInstruction: applyStepHandoff(step, context),
        }, signal);
    } catch (argErr) {
        if (argErr instanceof LLMServiceUnavailableError && argErr.raw) {
            deps.emitEvent(task.id, "ARGUMENTS_GENERATED", { error: argErr.message, rawInput: argErr.raw.rawInput, timing: argErr.raw.timing }, step.id);
        }
        if (!(argErr instanceof LLMValidationError)) throw argErr;
        console.error("[Qwen Args Error]", argErr.message);
        emitFailedArguments(run, argErr.attempts ?? (argErr.raw ? [{ ...argErr.raw, error: argErr.message }] : []));
        const argsError = `Argumentos inválidos: ${argErr.message}`;
        recordFailedCall(context, step, { status: "args_invalid", tool: selectedTool.name, error: argsError });
        return halt({ status: "logical_error", step, error: argsError });
    }
    emitFailedArguments(run, generated.failedAttempts ?? []);

    // Sustitución determinista de referencias {{ref:rX}} antes de Guard
    const refResolution = resolveReferences(generated.args, task.id, selectedTool.inputSchema);
    const args = refResolution.resolvedArgs;
    if (refResolution.replacedCount > 0) {
        console.log(`[runStep] Sustituidas ${refResolution.replacedCount} referencias (${refResolution.resolvedRefs.join(", ")}) desde RefStore.`);
    }

    deps.emitEvent(task.id, "ARGUMENTS_GENERATED", {
        args,
        resolvedRefs: refResolution.resolvedRefs,
        unresolvedRefs: refResolution.unresolvedRefs,
        replacedCount: refResolution.replacedCount,
        rawInput: generated.rawInput,
        rawOutput: generated.rawOutput,
        timing: generated.timing,
    }, step.id);

    // Una referencia inexistente nunca se envía literal a la herramienta.
    if (refResolution.unresolvedRefs.length > 0) {
        const refError = `Referencias sin resolver: ${refResolution.unresolvedRefs.join(", ")}`;
        recordFailedCall(context, step, { status: "refs_unresolved", tool: selectedTool.name, args, error: refError });
        return halt({ status: "logical_error", step, error: refError });
    }

    return proceed(args);
}

// ---------------------------------------------------------------
// Fase 4: anti-loop
// ---------------------------------------------------------------

/**
 * Devuelve la firma que debe registrarse justo antes del despacho (undefined si la herramienta está exenta). La firma no
 * se registra aquí: una llamada que nunca llegó a ejecutarse (Guard, rechazo del usuario, excepción de MCP) no puede
 * bloquear su propio reintento.
 */
function checkAntiLoop(
    { context, step }: StepRun,
    serverName: McpServerName,
    toolName: string,
    args: Record<string, unknown>,
    policy: Readonly<ToolPolicy>
): Phase<string | undefined> {
    if (policy.loopExempt) return proceed(undefined);

    const isRead = policy.kind === "READ";
    const sig = `${serverName}:${toolName}:${argsHash(args)}:m${context.nonReadCounter}`;
    // Lectura idéntica: siempre bloqueada. Acción idéntica: bloqueada si no hubo una lectura intermedia.
    if (context.executedSignatures.has(sig) && (isRead || !context.lastActionWasRead)) {
        context.consecutiveLoopBlocks++;
        const loopError = isRead
            ? "Lectura idéntica bloqueada por anti-loop."
            : "Invocación bloqueada por anti-loop (acción idéntica repetida sin lectura intermedia).";
        recordFailedCall(context, step, { status: "loop_blocked", tool: toolName, args, error: loopError });
        return halt({ status: "blocked_loop", step, error: loopError });
    }
    return proceed(sig);
}

// ---------------------------------------------------------------
// Fase 5: Guard y aprobación del usuario
// ---------------------------------------------------------------

/** Cierra el paso como BLOCKED por una denegación (Guard) o un rechazo del usuario. */
function blockStep(
    { context, step, deps }: StepRun,
    tool: MCPTool,
    args: Record<string, unknown>,
    status: "denied" | "user_rejected",
    error: string
): StepExecutionResult {
    step.state = "BLOCKED";
    step.error = error;
    recordFailedCall(context, step, { status, tool: tool.name, args, error });
    emitStepError(deps, context.task.id, step);
    return { status: "logical_error", step, error, signals: { denied: true } };
}

async function authorizeCall(
    run: StepRun,
    serverName: McpServerName,
    tool: MCPTool,
    args: Record<string, unknown>
): Promise<Phase<void>> {
    const { context, step, deps } = run;
    const { task } = context;

    const guardDecision = Guard.evaluate(serverName, tool.name, args);
    deps.emitEvent(task.id, "GUARD_EVALUATION", { guardDecision }, step.id);

    if (guardDecision.decision === "DENY") {
        return halt(blockStep(run, tool, args, "denied", guardDecision.reason || "Operación rechazada por Guard (DENY)."));
    }
    if (guardDecision.decision !== "APPROVAL") return proceed(undefined);

    task.state = "WAITING_INPUT";
    task.waitingReason = "approval";
    step.state = "WAITING_APPROVAL";
    emitStepStateChanged(deps, task.id, step, "WAITING_APPROVAL");
    deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "WAITING_INPUT", waitingReason: "approval" });

    const approved = await requestUserApproval(context, step, {
        mcp: serverName,
        tool: tool.name,
        args,
        capability: guardDecision.capability,
        reason: guardDecision.reason || "Operación sensible",
    }, deps.emitEvent);

    // La cancelación resuelve la aprobación como rechazo: no se debe revivir una tarea ya CANCELLED.
    if (isStopped(context)) return halt(cancelledResult(step));

    task.state = "RUNNING";
    task.waitingReason = undefined;

    if (!approved) {
        const blocked = blockStep(run, tool, args, "user_rejected", "Operación rechazada por el usuario en Guard.");
        deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "RUNNING" });
        return halt(blocked);
    }
    step.state = "RUNNING";
    emitStepStateChanged(deps, task.id, step, "RUNNING");
    deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "RUNNING" });
    return proceed(undefined);
}

// ---------------------------------------------------------------
// Fase 6: despacho al servidor MCP
// ---------------------------------------------------------------

interface DispatchOutput {
    rawResult: McpCallOutput;
    /** Solo la herramienta, sin la verificación posterior: distingue un comando lento de un modelo lento. */
    execution: TimeSpan;
}

async function dispatchTool(
    { context, step, deps }: StepRun,
    serverName: McpServerName,
    server: McpServer,
    tool: MCPTool,
    args: Record<string, unknown>,
    loopSignature: string | undefined
): Promise<Phase<DispatchOutput>> {
    const { task } = context;

    // Registro de invocación
    context.totalToolCalls++;
    if (isStopped(context)) return halt(cancelledResult(step));
    if (loopSignature) context.executedSignatures.add(loopSignature);

    deps.emitEvent(task.id, "MCP_DISPATCHED", { mcp: serverName, tool: tool.name, args }, step.id);
    console.log(`[MCP → SEND] server=${serverName} tool=${tool.name} args=${JSON.stringify(args).slice(0, 300)}`);
    let rawResult: McpCallOutput;
    const executionStart = Date.now();
    try {
        rawResult = await server.callTool(tool.name, args);
    } catch (callErr) {
        // Fallo de infraestructura: la herramienta no produjo resultado, el reintento idéntico debe poder ejecutarse.
        if (loopSignature) context.executedSignatures.delete(loopSignature);
        throw callErr;
    }
    const execution: TimeSpan = { startedAt: executionStart, durationMs: Date.now() - executionStart };
    console.log(`[MCP ← RECV] server=${serverName} tool=${tool.name} duration=${execution.durationMs}ms result=${JSON.stringify(rawResult).slice(0, 400)}`);

    // La tarea pudo cancelarse durante la llamada: un resultado tardío no toca memoria, refs ni eventos.
    if (isStopped(context)) {
        console.warn(`[runStep] Resultado tardío de '${tool.name}' descartado: la tarea ${task.id} ya no está activa.`);
        return halt(cancelledResult(step));
    }

    deps.emitEvent(task.id, "MCP_RESULT", { rawResult, execution }, step.id);
    return proceed({ rawResult, execution });
}

// ---------------------------------------------------------------
// Fase 7: procesamiento del resultado
// ---------------------------------------------------------------

function absorbResult(
    { context, step }: StepRun,
    serverName: McpServerName,
    tool: MCPTool,
    args: Record<string, unknown>,
    rawResult: McpCallOutput,
    policy: Readonly<ToolPolicy>
): ProcessedResult {
    const { task } = context;
    const processed: ProcessedResult = ResultProcessor.process(serverName, tool.name, rawResult, args, task.id);
    context.lastCallCompactObs = processed.compactObs;
    context.lastCallTool = tool.name;
    context.lastCallStepId = step.id;
    context.lastCallDecisionSummary = processed.decisionSummary;

    // Una lectura con datos se conserva aparte de la última llamada: un paso posterior (p. ej. crear un archivo con los
    // resultados de una búsqueda) la necesita aunque entre medias haya habido otras llamadas.
    if (!policy.mutates && processed.outcome.success && !processed.signals.empty_output && !processed.signals.not_found && processed.compactObs) {
        recordDataObservation(context, { stepId: step.id, label: refLabel(tool.name, args), text: processed.compactObs });
    }

    // El scratchpad es solo estado visible ("lo último visto"); los facts se registran tras la verificación.
    Object.assign(task.scratchpad, processed.scratchpadDelta);
    return processed;
}

// ---------------------------------------------------------------
// Fase 8: verificación (Eos y, en modo PLAN, Qwen como segundo juez)
// ---------------------------------------------------------------

interface Verdict {
    /** La herramienta corrió sin error, sin timeout, sin denegación y con datos. */
    isCleanSignals: boolean;
    eosPassed: boolean;
    eosUnavailable: boolean;
    /** Respuesta completa de Eos (null si no se consultó o no estuvo disponible). */
    eos: StepVerificationResult | null;
    /** Veredicto de Qwen como segundo juez (solo modo PLAN, cuando Eos no aprobó). */
    semantic?: StageVerificationResult;
    /** Etiqueta determinista de la acción ("read_file C:\x.txt"): su destino va al LOG y a Eos. */
    callLabel: string;
}

/**
 * Eos decide sobre señales limpias. En modo PLAN, si Eos no aprueba (rechaza o no está disponible), Qwen actúa como
 * segundo juez: el paso falla solo si fallan los dos. En FAST decide solo Eos.
 */
async function verifyResult(
    { context, step, deps, signal }: StepRun,
    tool: MCPTool,
    args: Record<string, unknown>,
    processed: ProcessedResult
): Promise<Verdict> {
    const { task } = context;
    const { signals } = processed;
    const isCleanSignals =
        !processed.outcome.isError &&
        !signals.exception &&
        !signals.timeout &&
        !signals.denied &&
        !signals.not_found &&
        !signals.empty_output &&
        (signals.exit_code === 0 || signals.exit_code === undefined);

    const callLabel = refLabel(tool.name, args);

    let eosPassed = false;
    let eosUnavailable = false;
    let eos: StepVerificationResult | null = null;

    if (isCleanSignals) {
        try {
            eos = await deps.decisionEngine.evaluateStepVerification(
                step.instruction,
                tool.name,
                // Resultado neutro: la etiqueta [SUCCESS] de decisionSummary ya concluye por el verificador.
                `${callLabel}: ${processed.finding}`,
                processed.evidence.summary,
                step.expectedOutcome,
                // Fragmento real de lo observado. Es texto externo: se sanea y se quitan los marcadores de omisión.
                sanitizeForMemory((processed.compactObs || "").replace(/\[\.\.\.[^\]]*\]/g, "[…]"), MAX_EVIDENCE_OBS_CHARS),
                signal
            );
            eosPassed = eos.ok && eos.cumple;
        } catch (verErr) {
            if (verErr instanceof RequestAbortedError) throw verErr;
            console.warn("[runStep] Verificación Eos no disponible:", errorMessage(verErr));
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
                executedAction: `${tool.name} ${JSON.stringify(args)}`,
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
                timing: semantic.timing,
            }, step.id);
            console.log(`[PLAN StageVerification] step=${step.id} status=${semantic.status} reason=${semantic.reason}`);
        } catch (semErr) {
            // Qwen caído: no hay segundo juez. Cualquier otro error (y la cancelación) se propaga.
            if (!(semErr instanceof LLMServiceUnavailableError)) throw semErr;
            console.warn("[runStep] Verificación semántica (Qwen) no disponible:", semErr.message);
        }
    }

    return { isCleanSignals, eosPassed, eosUnavailable, eos, semantic, callLabel };
}

// ---------------------------------------------------------------
// Fase 9: registro del resultado en el paso, la memoria y los eventos
// ---------------------------------------------------------------

/** Handoff determinista hacia el paso siguiente: hallazgo, referencia y hecho clave. */
function buildHandoff(step: Step, tool: MCPTool, processed: ProcessedResult): StepHandoff {
    const primaryFactKey = Object.keys(processed.factsDelta)[0];
    return {
        fromStepId: step.id,
        tool: tool.name,
        finding: processed.finding || "Paso ejecutado con éxito",
        primaryFact: primaryFactKey ? { key: primaryFactKey, value: processed.factsDelta[primaryFactKey] } : undefined,
        refKey: processed.refKey,
        timestamp: Date.now(),
    };
}

interface SettleInput {
    run: StepRun;
    serverName: McpServerName;
    tool: MCPTool;
    args: Record<string, unknown>;
    policy: Readonly<ToolPolicy>;
    processed: ProcessedResult;
    execution: TimeSpan;
    verdict: Verdict;
}

function settleCall(input: SettleInput): StepExecutionResult {
    const { run, serverName, tool, args, policy, processed, execution, verdict } = input;
    const { context, step, deps } = run;
    const { task } = context;
    const { signals } = processed;
    const { isCleanSignals, eosPassed, eosUnavailable, semantic, callLabel } = verdict;
    const isRead = policy.kind === "READ";

    const isStepSuccess = isCleanSignals && (eosPassed || semantic?.status === "completed");
    // Sin ningún veredicto (Eos no disponible y sin segundo juez) no se aprueba ni se rechaza: queda UNVERIFIED.
    const noVerdict = eosUnavailable && !semantic;
    // Estado único de la llamada: de él se derivan token del LOG, FAIL, evidence.ok, outcome.success, facts y efectos.
    const status = classifyCall({ clean: isCleanSignals, passed: isStepSuccess, noVerdict, signals });
    const notFailed = status === "ok" || status === "unverified";
    const verification: VerificationState =
        status === "unverified"
            ? "UNVERIFIED"
            : status === "ok"
                ? processed.verification
                : "NOT_REQUIRED";

    // Motivo del fallo (lo ven step.error, el replan y la UI): causa fija + hallazgo determinista de la herramienta.
    // Nunca prosa de Eos ni de Qwen: sus probabilidades y su `reason` viajan solo en los eventos y la traza.
    const failReason = notFailed
        ? undefined
        : sanitizeForMemory(describeFailure(status, processed.finding), MAX_EVIDENCE_OBS_CHARS);

    // Los facts son "hechos confirmados": solo se registran si el paso pasó la verificación, o si no pudo verificarse
    // por falta de verificadores (la herramienta corrió limpia). Excepción: una mutación ejecutada (p. ej. el pid de un
    // proceso lanzado) describe el entorno, no una hipótesis sobre el contenido, y debe conservarse.
    if (notFailed || policy.mutates) {
        Object.assign(ensureMemory(context).facts, processed.factsDelta);
    } else if (Object.keys(processed.factsDelta).length > 0) {
        console.log(`[runStep] Facts no confirmados descartados (${Object.keys(processed.factsDelta).join(", ")}): el paso no pasó la verificación.`);
    }

    // El resumen que ven Decision #1/#2 debe coincidir con el estado final: la etiqueta [SUCCESS] del extractor es
    // previa al veredicto, así que si el verificador rechazó la llamada se reemplaza (sin prosa de modelos).
    if (status === "rejected") {
        context.lastCallDecisionSummary = `[FAILURE] ${tool.name}: ${processed.finding}. Result not approved.`;
    } else if (status === "unverified") {
        context.lastCallDecisionSummary = `[INFO] ${tool.name}: ${processed.finding}. Not verified.`;
    }

    addLogEntry(context, `${step.id}|${callLabel}|${LOG_TOKEN[status]}|${processed.finding}`);

    if (processed.outcome.success || notFailed) {
        if (!isRead) context.nonReadCounter++;
        context.lastActionWasRead = isRead;
        context.consecutiveLoopBlocks = 0;
    }

    // Registro de la llamada. `evidence.ok` alimenta los intentos que ven Decision #1/#2: sin veredicto la
    // herramienta corrió limpia, así que no se marca como fallida; `outcome.success` (compuerta de `fin`) sí queda en false.
    // Los efectos en el entorno se derivan de estos registros (buildEffectsContext): no hay otro almacén.
    const callRecord: StepCall = {
        id: newCallId(step),
        mcp: serverName,
        tool: tool.name,
        args,
        status,
        evidence: {
            ...processed.evidence,
            ok: notFailed,
            obs: processed.compactObs ? processed.compactObs.slice(0, MAX_EVIDENCE_OBS_CHARS) : undefined,
        },
        verification,
        outcome: { ...processed.outcome, success: status === "ok" },
        error: status === "unverified" ? "Verificación no disponible" : failReason,
        timestamp: Date.now(),
        execution,
    };

    if (status === "ok") {
        const handoff = buildHandoff(step, tool, processed);
        step.handoff = handoff;
        context.lastHandoff = handoff;
    } else {
        context.lastHandoff = undefined;
    }

    step.calls = step.calls || [];
    step.calls.push(callRecord);

    // Reflejo de la última llamada en el Step (compatibilidad con la UI)
    step.args = args;
    step.evidence = callRecord.evidence;
    step.verification = verification;
    step.outcome = callRecord.outcome;

    deps.emitEvent(task.id, "RESULT_PROCESSED", {
        processed,
        callStatus: status,
        execution,
        verification: verdict.eos,
        eosUnavailable,
        isStepSuccess,
        verificationState: verification,
        verifiedBy: eosPassed ? "eos" : semantic?.status === "completed" ? "qwen" : undefined,
        rawInput: verdict.eos?.rawInput,
        rawOutput: verdict.eos?.rawOutput,
    }, step.id);

    if (status === "unverified") {
        return { status: "unverified", step, call: callRecord, signals };
    }

    if (status !== "ok") {
        // Con una pregunta pendiente al usuario el fallo no es una lección para el FAIL: lo gestiona el modo PLAN.
        if (semantic?.status !== "insufficient_info") {
            recordFailure(context, status, { stepId: step.id, subject: tool.name });
        }
        return { status: "logical_error", step, call: callRecord, error: failReason, signals, semantic };
    }

    return { status: "ok", step, call: callRecord, signals, semantic };
}

/**
 * Motor unificado de ejecución atómica de pasos. Cada fase es una función con una responsabilidad; las que pueden
 * terminar el paso antes de tiempo devuelven un `Phase` con el resultado ya construido.
 * Contrato de errores: los fallos de dominio (argumentos inválidos, anti-loop, Guard, resultado inválido) se
 * devuelven como StepExecutionResult; los fallos de infraestructura (Qwen/Decision caídos, MCP no disponible,
 * cancelación) se propagan como excepción y los decide el motor de modo.
 */
export async function runStep(
    context: TaskExecutionContext,
    step: Step,
    deps: EngineDependencies
): Promise<StepExecutionResult> {
    const run: StepRun = { context, step, deps, signal: context.abortController.signal };

    if (isStopped(context)) return cancelledResult(step);

    const { serverName, server, tools } = await discoverCandidateTools(run);

    const selectedTool = await selectTool(run, serverName, tools);
    if (!selectedTool) return cancelledResult(step);

    const generated = await generateStepArguments(run, selectedTool);
    if (generated.proceed === false) return generated.result;
    const args = generated.value;

    const policy = getToolPolicy(serverName, selectedTool.name);

    const loopCheck = checkAntiLoop(run, serverName, selectedTool.name, args, policy);
    if (loopCheck.proceed === false) return loopCheck.result;

    const authorized = await authorizeCall(run, serverName, selectedTool, args);
    if (authorized.proceed === false) return authorized.result;

    const dispatched = await dispatchTool(run, serverName, server, selectedTool, args, loopCheck.value);
    if (dispatched.proceed === false) return dispatched.result;
    const { rawResult, execution } = dispatched.value;

    const processed = absorbResult(run, serverName, selectedTool, args, rawResult, policy);
    const verdict = await verifyResult(run, selectedTool, args, processed);

    return settleCall({ run, serverName, tool: selectedTool, args, policy, processed, execution, verdict });
}