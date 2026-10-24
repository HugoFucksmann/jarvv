/**
 * JARVIS Core — Execution Mode Engines (FAST, PLAN, Replan, Escalation)
 */

import {
    MAX_ESCALATIONS,
    MAX_EVIDENCE_OBS_CHARS,
    MAX_REPLAN,
    MAX_STEPS,
    MAX_USER_QUESTIONS_PER_STEP,
    isTerminalState,
    type ExecutableRoute,
    type PlanStep,
    type Step,
    type StepExecutionResult,
    type StepRoute,
    type StepState,
    type TaskState,
} from "./types.ts";
import { getToolPolicy } from "./tools/manifest.ts";
import { recordTaskTrace } from "./taskTrace.ts";
import {
    type TaskExecutionContext,
    addFailEntry,
    buildAttempts,
    buildHistoryContext,
    expandMemoryContext,
    hasUnresolvedUnverified,
} from "./context.ts";
import { type EngineDependencies, recordFailedCall, runStep } from "./callExecutor.ts";
import { RequestAbortedError } from "./llmTransport.ts";
import { LLMServiceUnavailableError } from "./reasoner/qwen.ts";
import { DecisionServiceUnavailableError } from "./decision.ts";
import { sanitizeForMemory } from "./processor/resultProcessor.ts";

/** ¿Hay que abandonar el trabajo en curso? (cancelación o estado terminal) */
const isStopped = (context: TaskExecutionContext): boolean =>
    context.isCancelled || isTerminalState(context.task.state);

/** Una cancelación del usuario nunca es un error que reportar. */
const isCancellation = (context: TaskExecutionContext, err: unknown): boolean =>
    context.isCancelled || err instanceof RequestAbortedError;

/** PARTIAL si se completó al menos un paso productivo; FAILED si no. */
function resolveFailureState(task: TaskExecutionContext["task"]): TaskState {
    return task.steps.some((s) => s.state === "COMPLETED") ? "PARTIAL" : "FAILED";
}

/** Decision #1 con allowFin=false solo puede devolver rutas ejecutables. */
function toExecutableRoute(route: StepRoute): ExecutableRoute {
    if (route === "fin") {
        throw new Error("Decision #1 devolvió 'fin' con allowFin=false.");
    }
    return route;
}

/** PlanStep validado -> Step pendiente. Sin valores por defecto: ruta y criterio vienen validados de qwen.ts. */
export function planStepsToSteps(steps: readonly PlanStep[], rev: number): Step[] {
    return steps.map((s) => ({
        id: s.id,
        route: s.route,
        instruction: s.instruction,
        expectedOutcome: s.expectedOutcome,
        state: "PENDING",
        calls: [],
        rev,
        superseded: false,
    }));
}

/**
 * Cierra la tarea ante un fallo de infraestructura LLM (Qwen o Decision no disponibles, salida inválida
 * persistente). Genera respuesta final con lo logrado. La cancelación se ignora. Devuelve siempre false.
 */
async function concludeOnLLMError(
    context: TaskExecutionContext,
    deps: EngineDependencies,
    what: string,
    err: unknown
): Promise<false> {
    if (isCancellation(context, err) || isTerminalState(context.task.state)) return false;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${what}] ${msg}`);
    await concludeTask(context, resolveFailureState(context.task), deps, `${what}: ${msg}`);
    return false;
}

/**
 * Estado de un plan que se quedó sin pasos ejecutables pero con pasos sin resolver (UNVERIFIED): COMPLETED solo
 * si todos los pasos vigentes están COMPLETED. PARTIAL si hubo trabajo hecho (completado o sin verificar).
 */
function resolveIncompleteState(task: TaskExecutionContext["task"]): TaskState {
    const live = task.steps.filter((s) => !s.superseded);
    return live.some((s) => s.state === "COMPLETED" || s.state === "UNVERIFIED") ? "PARTIAL" : "FAILED";
}

/**
 * Cierra como FAILED una tarea cuyo pipeline lanzó una excepción. Único punto de cierre por excepción: lo usan
 * todos los puntos de entrada y la planificación inválida. La cancelación y los estados terminales no se pisan.
 * Deja siempre una respuesta final legible (sin depender de que Qwen esté disponible).
 */
export function failTask(context: TaskExecutionContext, deps: EngineDependencies, err: unknown): void {
    const { task } = context;
    if (isCancellation(context, err) || isTerminalState(task.state)) return;

    const msg = err instanceof Error ? err.message : String(err);
    console.error(
        `[Task Summary] id=${task.id} state=FAILED reason="${msg}" calls=${context.totalToolCalls} escalations=${context.escalations} duration=${Date.now() - context.startTime}ms`
    );
    task.state = "FAILED";
    task.waitingReason = undefined;
    task.pendingQuestion = undefined;
    task.finalResponse = task.finalResponse || `La tarea falló: ${msg}`;
    deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "FAILED", error: msg, finalResponse: task.finalResponse });
    recordTaskTrace(context);
}


// CONCLUSION & FINAL RESPONSE

export async function concludeTask(
    context: TaskExecutionContext,
    state: TaskState,
    deps: EngineDependencies,
    abortReason?: string
): Promise<void> {
    const { task } = context;

    // Invarianza de estados terminales: si la tarea ya fue cancelada, ningún resultado tardío la altera.
    if (context.isCancelled || task.state === "CANCELLED") {
        console.log(`[concludeTask] Tarea ${task.id} previamente cancelada. Ignorando conclusión tardía.`);
        return;
    }

    // Evidencia: las lecturas con datos (p. ej. los resultados de una búsqueda anterior) y las últimas acciones que
    // cambiaron algo. Antes eran solo las últimas 3 llamadas: los datos leídos al principio desaparecían de la respuesta.
    const dataEvidence = context.dataObs.map((o) => `${o.label}: ${o.text}`);
    const actionEvidence = task.steps
        .flatMap((s) => s.calls || [])
        .filter((c) => getToolPolicy(c.mcp, c.tool).mutates)
        .slice(-3)
        .map((c) => {
            const obs = (c.evidence?.obs || c.evidence?.summary || "").trim().slice(0, MAX_EVIDENCE_OBS_CHARS);
            return obs ? `${c.tool}: ${obs}` : "";
        })
        .filter(Boolean);
    const evidenceSummaries = [...dataEvidence, ...actionEvidence];
    if (evidenceSummaries.length === 0 && abortReason) {
        evidenceSummaries.push(`abort: ${abortReason.slice(0, 1500)}`);
    }

    let finalRawInput: string | undefined;
    let finalRawOutput: string | undefined;
    try {
        const finalRes = await deps.qwenEngine.generateFinalResponse({
            goal: task.message,
            logLines: task.memory?.log || [],
            facts: task.memory?.facts || {},
            failLines: task.memory?.fail || [],
            effects: task.memory?.effects || [],
            evidenceSummaries,
            abortReason,
        }, context.abortController.signal);
        task.finalResponse = finalRes.response;
        finalRawInput = finalRes.rawInput;
        finalRawOutput = finalRes.rawOutput;
    } catch (err) {
        if (!isCancellation(context, err)) {
            console.error(`[concludeTask] Error al generar respuesta final con Qwen:`, err instanceof Error ? err.message : err);
        }
        const factsEntries = Object.entries(task.memory?.facts || {});
        const logLines = task.memory?.log || [];

        if (factsEntries.length > 0 || evidenceSummaries.length > 0 || logLines.length > 0) {
            const parts: string[] = [];
            if (factsEntries.length > 0) {
                parts.push(`Hallazgos:\n${factsEntries.map(([k, v]) => `• ${k}: ${v}`).join("\n")}`);
            }
            if (evidenceSummaries.length > 0) {
                parts.push(`Evidencias:\n${evidenceSummaries.map((e) => `• ${e}`).join("\n")}`);
            } else if (logLines.length > 0) {
                parts.push(`Acciones realizadas:\n${logLines.slice(-3).map((l) => `• ${l}`).join("\n")}`);
            }
            task.finalResponse = `Información recopilada para su solicitud:\n\n${parts.join("\n\n")}`;
        } else {
            task.finalResponse = `Tarea concluida con estado ${state}.${abortReason ? ` Motivo: ${abortReason}` : ""}`;
        }
    }

    // La generación fue asíncrona: la tarea pudo cancelarse mientras tanto.
    if (context.isCancelled || (task.state as TaskState) === "CANCELLED") {
        console.log(`[concludeTask] Tarea ${task.id} cancelada durante generación de respuesta final. Descartando resultado.`);
        return;
    }

    task.state = state;
    task.pendingQuestion = undefined;
    task.waitingReason = undefined;
    task.rawFinalInput = finalRawInput;
    task.rawFinalOutput = finalRawOutput;
    console.log(
        `[Task Summary] id=${task.id} state=${state} reason="${abortReason || 'None'}" calls=${context.totalToolCalls} escalations=${context.escalations} duration=${Date.now() - context.startTime}ms`
    );
    deps.emitEvent(task.id, "FINAL_RESPONSE", {
        response: task.finalResponse,
        rawInput: finalRawInput,
        rawOutput: finalRawOutput,
    });
    deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state, finalResponse: task.finalResponse });
    recordTaskTrace(context);
}


// ESCALATION & REPLAN


/**
 * Escalación FAST tras un fallo de paso. Devuelve true si el bucle debe continuar.
 * El arbitraje es de Decision #1; sin arbitraje no se adivina una ruta: la tarea se cierra.
 */
export async function handleEscalation(
    context: TaskExecutionContext,
    step: Step,
    execResult: StepExecutionResult,
    deps: EngineDependencies
): Promise<boolean> {
    const { task } = context;

    if (isStopped(context)) return false;

    // Un DENY de Guard o un rechazo del usuario jamás se elude.
    if (execResult.signals?.denied) {
        console.warn(`[Escalation] Acción denegada por Guard o usuario (denied). Prohibido reintentar o conmutar para eludir seguridad.`);
        await concludeTask(context, resolveFailureState(task), deps, "Operación denegada por política de seguridad (Guard).");
        return false;
    }

    expandMemoryContext(context);

    if (context.escalations >= MAX_ESCALATIONS) {
        console.warn(`[Escalation] MAX_ESCALATIONS (${MAX_ESCALATIONS}) agotado.`);
        await concludeTask(context, resolveFailureState(task), deps, "Tope de escalaciones agotado.");
        return false;
    }

    context.escalations++;
    task.escalations = context.escalations;
    console.log(`[Escalation] Activando arbitraje de recuperación (${context.escalations}/${MAX_ESCALATIONS}).`);

    // La tool fallida no se reintenta de inmediato
    if (step.tool) {
        context.excludedToolForNextCall = step.tool;
    }

    let arbitration;
    try {
        arbitration = await deps.decisionEngine.evaluateDecisionOne(
            task.message,
            buildHistoryContext(task, context.memoryRetrievalLimit),
            {
                allowFin: true,
                lastResult: context.lastCallDecisionSummary || context.lastCallCompactObs,
                attempts: buildAttempts(task),
                signal: context.abortController.signal,
            }
        );
    } catch (err) {
        return concludeOnLLMError(context, deps, "Arbitraje de recuperación (Decision #1)", err);
    }

    deps.emitEvent(task.id, "DECISION_ONE", {
        route: arbitration.route,
        probabilities: arbitration.probabilities,
        rawInput: arbitration.rawInput,
        rawOutput: arbitration.rawOutput,
        purpose: "escalation",
    });

    if (arbitration.route === "fin") {
        console.log(`[Escalation] Decision #1 determinó fin de alternativas viables.`);
        await concludeTask(context, resolveFailureState(task), deps, "Fin de alternativas viables según arbitraje de Decision 2.0.");
        return false;
    }

    if (arbitration.route !== step.route) {
        console.log(`[Escalation] Decision #1 determinó conmutar subsistema a '${arbitration.route}'.`);
        context.activeRouteOverride = arbitration.route;
    }
    return true;
}

export async function handleReplan(
    context: TaskExecutionContext,
    failedStepIndex: number,
    deps: EngineDependencies
): Promise<boolean> {
    const { task } = context;

    if (isStopped(context)) return false;

    if ((task.replans || 0) >= MAX_REPLAN) {
        console.warn(`[PLAN] MAX_REPLAN (${MAX_REPLAN}) alcanzado.`);
        await concludeTask(context, resolveFailureState(task), deps, "Límite de replanificaciones alcanzado.");
        return false;
    }

    task.replans = (task.replans || 0) + 1;

    const failedStep = task.steps[failedStepIndex];
    console.log(`[PLAN] Activando Replan autónomo (${task.replans}/${MAX_REPLAN}) para paso '${failedStep.id}'.`);

    // Los pasos sin verificar también se informan ([~]): su trabajo está hecho aunque no se haya podido confirmar.
    const completedSummary = task.steps
        .slice(0, failedStepIndex)
        .filter((s) => !s.superseded && (s.state === "COMPLETED" || s.state === "UNVERIFIED"))
        .map((s) => `${s.state === "COMPLETED" ? "[x]" : "[~]"} ${s.id} ${s.instruction} -> ${s.evidence?.summary || 'ok'}`);

    const remainingGoals = task.steps
        .slice(failedStepIndex + 1)
        .map((s) => `[ ] ${s.id} ${s.instruction}`);

    const nextIdNum = (task.stepSeq ?? 0) + 1;

    let replanResult;
    try {
        replanResult = await deps.qwenEngine.replan({
            goal: task.message,
            completedStepsSummary: completedSummary,
            facts: task.memory?.facts || {},
            failLines: task.memory?.fail || [],
            logLines: task.memory?.log || [],
            // Las mutaciones ya aplicadas no se deshacen con la verificación: el replan debe conocerlas.
            effects: task.memory?.effects || [],
            failedStepGoal: failedStep.instruction,
            failedStepResult: failedStep.error || "error",
            remainingPlanGoals: remainingGoals,
            nextStepNumber: nextIdNum,
        }, context.abortController.signal);
    } catch (err) {
        return concludeOnLLMError(context, deps, "Replan", err);
    }

    if (isStopped(context)) return false;

    if (replanResult.action === "abort" || !replanResult.plan) {
        console.log(`[PLAN Replan] Replan devolvió abort: ${replanResult.reason}`);
        await concludeTask(context, resolveFailureState(task), deps, replanResult.reason || "Replan abortado.");
        return false;
    }

    for (let i = failedStepIndex; i < task.steps.length; i++) {
        task.steps[i].superseded = true;
    }

    const newSteps = planStepsToSteps(replanResult.plan.steps, (failedStep.rev || 0) + 1);
    task.steps.push(...newSteps);
    task.stepSeq = (task.stepSeq ?? 0) + newSteps.length;
    task.rawPlanInput = replanResult.rawInput;
    task.rawPlanOutput = replanResult.rawOutput;

    // Ejecución autónoma: sin suspensión en WAITING_INPUT tras la confirmación inicial
    deps.emitEvent(task.id, "PLAN_GENERATED", {
        steps: task.steps,
        replan: true,
        isMaterialReplan: false,
        rawInput: replanResult.rawInput,
        rawOutput: replanResult.rawOutput,
    });
    console.log(`[PLAN] Replan autónomo completado. Continuando ejecución directa de ${newSteps.length} pasos.`);
    return true;
}

/**
 * Registra un fallo no controlado durante runStep, marca el paso como FAILED,
 * registra la llamada fallida y emite STEP_COMPLETED.
 */
function recordStepCrash(
    context: TaskExecutionContext,
    step: Step,
    stepIndex: number,
    deps: EngineDependencies,
    loopTag: "FAST" | "PLAN",
    err: unknown
): void {
    console.error(`[${loopTag}] Excepción no controlada en runStep:`, err);
    step.state = "FAILED";
    step.error = err instanceof Error ? err.message : String(err);
    const unavailable = err instanceof LLMServiceUnavailableError || err instanceof DecisionServiceUnavailableError;
    const subject = step.tool ?? step.route;
    addFailEntry(context, `${subject} -> ${unavailable ? "servicio no disponible" : "excepción"}: ${sanitizeForMemory(step.error, 100)}`);
    if (unavailable) {
        context.lastHandoff = undefined;
        context.lastCallDecisionSummary = `[FAILURE] ${subject}: ${sanitizeForMemory(step.error, 120)}.`;
    } else {
        recordFailedCall(context, step, { error: step.error });
    }
    deps.emitEvent(context.task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);
}


// FAST MODE ENGINE

export async function runFastLoop(
    context: TaskExecutionContext,
    deps: EngineDependencies
): Promise<void> {
    const { task } = context;
    const signal = context.abortController.signal;

    /** Decision #1 sobre el estado actual de la tarea. */
    const askRoute = (allowFin: boolean) =>
        deps.decisionEngine.evaluateDecisionOne(
            task.message,
            buildHistoryContext(task, context.memoryRetrievalLimit),
            {
                allowFin,
                lastResult: context.lastCallDecisionSummary || context.lastCallCompactObs,
                attempts: buildAttempts(task),
                signal,
            }
        );

    while (!isStopped(context)) {
        if ((task.stepSeq ?? 0) >= MAX_STEPS) {
            console.warn(`[FAST] MAX_STEPS (${MAX_STEPS}) alcanzado. Parada controlada PARTIAL.`);
            await concludeTask(context, "PARTIAL", deps, "Límite MAX_STEPS alcanzado.");
            return;
        }

        // Paso 1: Decision #1 (ruta)
        let selectedRoute: ExecutableRoute;

        if (context.activeRouteOverride) {
            selectedRoute = context.activeRouteOverride;
            context.activeRouteOverride = undefined;
        } else {
            const isFirst = task.stepSeq === 0;
            let d1;
            try {
                d1 = await askRoute(true);
            } catch (err) {
                await concludeOnLLMError(context, deps, "Decision #1", err);
                return;
            }

            deps.emitEvent(task.id, "DECISION_ONE", {
                route: d1.route,
                probabilities: d1.probabilities,
                rawInput: d1.rawInput,
                rawOutput: d1.rawOutput,
            });

            if (d1.route === "fin") {
                if (isFirst) {
                    console.log(`[FAST] Conversación directa (fin inicial). Concluyendo directo.`);
                    await concludeTask(context, "COMPLETED", deps);
                    return;
                }

                const hasSuccessfulTool = task.steps.some((s) => s.calls && s.calls.some((c) => c.outcome?.success));
                const hasPendingUnverified = hasUnresolvedUnverified(task);

                if (hasSuccessfulTool && !hasPendingUnverified) {
                    console.log(`[FAST] fin validado. Concluyendo con éxito.`);
                    await concludeTask(context, "COMPLETED", deps);
                    return;
                }

                console.warn(`[FAST] fin rechazado por validación de Core. Solicitando mejor ruta ejecutable.`);
                addFailEntry(context, "fin rechazado: faltan acciones verificadas previas");
                try {
                    const alt = await askRoute(false);
                    selectedRoute = toExecutableRoute(alt.route);

                    deps.emitEvent(task.id, "DECISION_ONE", {
                        route: alt.route,
                        probabilities: alt.probabilities,
                        rawInput: alt.rawInput,
                        rawOutput: alt.rawOutput,
                        purpose: "reselection",
                    });
                } catch (err) {
                    await concludeOnLLMError(context, deps, "Decision #1 (reselección tras fin rechazado)", err);
                    return;
                }
            } else {
                selectedRoute = d1.route;
            }
        }

        if (isStopped(context)) return;

        // Crear el Step de esta iteración
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
        deps.emitEvent(task.id, "STEP_STATE_CHANGED", { step, stepIndex, state: "RUNNING" }, step.id);

        // Ejecución única con el motor unificado
        let execResult: StepExecutionResult;
        try {
            execResult = await runStep(context, step, deps);
        } catch (err) {
            if (isCancellation(context, err)) return;
            recordStepCrash(context, step, stepIndex, deps, "FAST", err);

            const syntheticResult: StepExecutionResult = {
                status: "logical_error",
                step,
                error: step.error,
                signals: { exception: true },
            };
            if (!await handleEscalation(context, step, syntheticResult, deps)) {
                return;
            }
            continue;
        }

        if (execResult.status === "ok") {
            step.state = "COMPLETED";
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
        } else if (execResult.status === "unverified") {
            step.state = "UNVERIFIED";
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
            console.warn(`[FAST] Acción UNVERIFIED registrada. Requiere observación.`);
        } else if (execResult.status === "blocked_loop") {
            step.state = "BLOCKED";
            step.error = execResult.error || "Invocación bloqueada por anti-loop.";
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

            if (context.consecutiveLoopBlocks >= 2) {
                console.warn(`[FAST] 2 bloqueos seguidos de anti-loop. Cerrando PARTIAL.`);
                await concludeTask(context, "PARTIAL", deps, "Detenido por anti-loop (2 bloqueos seguidos).");
                return;
            }
        } else {
            step.state = "FAILED";
            step.error = execResult.error || "Fallo lógico en ejecución.";
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

            if (!await handleEscalation(context, step, execResult, deps)) {
                return;
            }
        }
    }
}


// PLAN MODE ENGINE

export async function initiatePlanMode(
    context: TaskExecutionContext,
    deps: EngineDependencies
): Promise<void> {
    const { task } = context;
    const signal = context.abortController.signal;

    if (isStopped(context)) return;

    let plan;
    try {
        plan = await deps.qwenEngine.generatePlan(task.message, undefined, signal);
    } catch (err) {
        if (isCancellation(context, err)) {
            return;
        }
        console.error(`[PLAN] Plan inválido:`, err instanceof Error ? err.message : err);
        failTask(context, deps, new Error(`Plan inválido: ${err instanceof Error ? err.message : String(err)}`));
        return;
    }

    if (isStopped(context)) {
        return;
    }


    if (plan.steps.length === 0) {
        console.log(`[PLAN] El plan no requiere herramientas. Concluyendo con respuesta directa.`);
        task.rawPlanInput = plan.rawInput;
        task.rawPlanOutput = plan.rawOutput;
        await concludeTask(context, "COMPLETED", deps);
        return;
    }

    task.steps = planStepsToSteps(plan.steps, 0);
    task.stepSeq = task.steps.length;
    task.planConfirmed = false;
    task.rawPlanInput = plan.rawInput;
    task.rawPlanOutput = plan.rawOutput;
    task.state = "WAITING_INPUT";
    task.waitingReason = "plan_confirmation";
    deps.emitEvent(task.id, "PLAN_GENERATED", {
        steps: task.steps,
        rawInput: plan.rawInput,
        rawOutput: plan.rawOutput,
    });
    deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "WAITING_INPUT", waitingReason: "plan_confirmation" });
    console.log(`[PLAN] Plan generado con ${task.steps.length} pasos. Esperando confirmación inicial en WAITING_INPUT.`);
}

export async function runPlanLoop(
    context: TaskExecutionContext,
    deps: EngineDependencies
): Promise<void> {
    const { task } = context;

    while (!isStopped(context) && (task.state as TaskState) !== "WAITING_INPUT") {
        const stepIndex = task.steps.findIndex((s) => !s.superseded && (s.state === "PENDING" || s.state === "RUNNING"));
        if (stepIndex === -1) {

            const unresolved = task.steps.filter((s) => !s.superseded && s.state !== "COMPLETED");
            if (unresolved.length === 0) {
                console.log(`[PLAN] Todos los pasos completados. Concluyendo tarea.`);
                await concludeTask(context, "COMPLETED", deps);
                return;
            }
            const detail = unresolved.map((s) => `${s.id}=${s.state}`).join(", ");
            console.warn(`[PLAN] Sin pasos ejecutables pero con pasos sin resolver (${detail}). No se declara COMPLETED.`);
            await concludeTask(context, resolveIncompleteState(task), deps, `Pasos sin resolver o sin verificar: ${detail}.`);
            return;
        }

        task.currentStep = stepIndex;
        const step = task.steps[stepIndex];

        step.state = "RUNNING";
        deps.emitEvent(task.id, "STEP_STATE_CHANGED", { step, stepIndex, state: "RUNNING" }, step.id);


        let execResult: StepExecutionResult;
        try {
            execResult = await runStep(context, step, deps);
        } catch (err) {
            if (isCancellation(context, err)) return;
            recordStepCrash(context, step, stepIndex, deps, "PLAN", err);

            if (!await handleReplan(context, stepIndex, deps)) {
                return;
            }
            continue;
        }

        if (isStopped(context) || (task.state as TaskState) === "WAITING_INPUT") {
            return;
        }


        if (execResult.signals?.denied || (step.state as StepState) === "BLOCKED") {
            console.warn(`[PLAN] Acción denegada por Guard o usuario. Prohibido replanificar para eludir denegación.`);
            await concludeTask(context, resolveFailureState(task), deps, "Operación denegada por política de seguridad (Guard).");
            return;
        }

        if (execResult.status === "ok") {
            step.state = "COMPLETED";
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
            continue;
        }

        if (execResult.status === "unverified") {
            step.state = "UNVERIFIED";
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
            console.log(`[PLAN] Paso ${step.id} registrado como UNVERIFIED. Continuando hacia la siguiente etapa.`);
            continue;
        }

        // logical_error | blocked_loop. `semantic` es el veredicto de Qwen cuando Eos no aprobó el paso.
        step.error = execResult.error || "Fallo en ejecución del paso.";
        const semantic = execResult.semantic;

        if (semantic?.status === "insufficient_info") {
            if ((step.questionsAsked ?? 0) < MAX_USER_QUESTIONS_PER_STEP) {
                // La pregunta vive en la tarea (task.pendingQuestion). provideUserAnswer reabre este paso.
                const question = semantic.questionForUser || semantic.reason;
                step.questionsAsked = (step.questionsAsked ?? 0) + 1;
                step.state = "UNVERIFIED";
                task.pendingQuestion = { stepId: step.id, question, reason: semantic.reason, askedAt: Date.now() };
                task.state = "WAITING_INPUT";
                task.waitingReason = "user_answer";
                deps.emitEvent(task.id, "TASK_STATE_CHANGED", {
                    state: "WAITING_INPUT",
                    waitingReason: "user_answer",
                    question,
                    stepId: step.id,
                }, step.id);
                console.log(`[PLAN] Información insuficiente en etapa '${step.id}' (pregunta ${step.questionsAsked}/${MAX_USER_QUESTIONS_PER_STEP}). Esperando respuesta del usuario.`);
                return;
            }
            // Tope de preguntas agotado: la falta de información se trata como desviación recuperable.
            step.error = `Información insuficiente tras ${step.questionsAsked} preguntas al usuario: ${semantic.reason}`;
            addFailEntry(context, `${step.id} -> información insuficiente tras ${step.questionsAsked} preguntas`);
        } else if (semantic?.status === "unrecoverable_blocked") {
            step.state = "BLOCKED";
            step.error = semantic.reason;
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);
            await concludeTask(context, resolveFailureState(task), deps, semantic.reason);
            return;
        }

        step.state = "FAILED";
        deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

        if (!await handleReplan(context, stepIndex, deps)) {
            return;
        }
    }
}