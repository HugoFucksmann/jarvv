/**
 * JARVIS Core — Execution Mode Engines (FAST, PLAN, Replan, Escalation)
 */

import {
    TaskState,
    Step,
    StepState,
    StepRoute,
    MAX_STEPS,
    MAX_ESCALATIONS,
    MAX_REPLAN,
    StepExecutionResult,
    isTerminalState,
} from "./types.ts";
import { RefStore } from "./processor/resultProcessor.ts";
import {
    TaskExecutionContext,
    addFailEntry,
    buildHistoryContext,
    buildAttempts,
    expandMemoryContext,
} from "./context.ts";
import {
    EngineDependencies,
    runStep,
} from "./callExecutor.ts";
import { isStepRoute } from "./reasoner/qwen.ts";

/**
 * Determina determinísticamente si una tarea abortada califica como PARTIAL o FAILED
 * según si completó al menos un paso productivo.
 */
function resolveFailureState(task: TaskExecutionContext["task"]): TaskState {
    return task.steps.some((s) => s.state === "COMPLETED") ? "PARTIAL" : "FAILED";
}

// ============================================================
// CONCLUSION & FINAL RESPONSE (§4, §5, Etapa 6)
// ============================================================
export async function concludeTask(
    context: TaskExecutionContext,
    state: TaskState,
    deps: EngineDependencies,
    abortReason?: string
): Promise<void> {
    const { task } = context;

    // Invarianza de estados terminales (§8.2, Fase 2): si la tarea ya alcanzó un estado terminal
    // (ej. CANCELLED), ningún resultado tardío puede alterar dicho estado.
    if (context.isCancelled || task.state === "CANCELLED") {
        console.log(`[concludeTask] Tarea ${task.id} previamente cancelada. Ignorando conclusión tardía.`);
        RefStore.clear(task.id);
        return;
    }

    task.state = state;

    const lastCalls = task.steps
        .flatMap((s) => s.calls || [])
        .slice(-3);
    const safeStr = (s: string) => s.replace(/<\/?obs>/gi, "[obs]");
    const evidenceSummaries = lastCalls
        .map((c) => {
            const obs = (c.evidence?.obs || c.evidence?.summary || "").trim().slice(0, 1500);
            return obs ? `${c.tool}: ${safeStr(obs)}` : "";
        })
        .filter(Boolean);
    if (evidenceSummaries.length === 0 && abortReason) {
        evidenceSummaries.push(`abort: ${safeStr(abortReason).slice(0, 1500)}`);
    }

    let finalRawInput: string | undefined;
    let finalRawOutput: string | undefined;
    try {
        const finalRespRes = await deps.qwenEngine.generateFinalResponse({
            goal: task.message,
            logLines: task.memory?.log || [],
            facts: task.memory?.facts || {},
            failLines: task.memory?.fail || [],
            effects: task.memory?.effects || [],
            evidenceSummaries,
            abortReason,
        }, context.abortController.signal);
        task.finalResponse = finalRespRes.response;
        finalRawInput = finalRespRes.rawInput;
        finalRawOutput = finalRespRes.rawOutput;
    } catch (err: any) {
        console.error(`[concludeTask] Error al generar respuesta final con Qwen:`, err);
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

    // Verificación de invarianza tras generación asíncrona
    if (context.isCancelled || task.state === "CANCELLED") {
        console.log(`[concludeTask] Tarea ${task.id} cancelada durante generación de respuesta final. Descartando resultado.`);
        RefStore.clear(task.id);
        return;
    }

    // Limpieza exclusiva de las referencias de esta tarea
    RefStore.clear(task.id);
    task.rawFinalInput = finalRawInput;
    task.rawFinalOutput = finalRawOutput;
    deps.persistTasks();
    const durationTotalMs = Date.now() - context.startTime;
    console.log(
        `[Task Summary] id=${task.id} state=${state} reason="${abortReason || 'None'}" calls=${context.totalToolCalls} escalations=${context.escalations} overrides=${context.overridesCount} retries=${context.retriesCount} duration=${durationTotalMs}ms`
    );
    deps.emitEvent(task.id, "FINAL_RESPONSE", {
        response: task.finalResponse,
        rawInput: finalRawInput,
        rawOutput: finalRawOutput,
    });
    deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state, finalResponse: task.finalResponse });
}

// ============================================================
// ESCALATION & REPLAN (§4, §5B, §9.4)
// ============================================================
export async function handleEscalation(
    context: TaskExecutionContext,
    step: Step,
    execResult: StepExecutionResult,
    deps: EngineDependencies
): Promise<boolean> {
    const { task } = context;

    if (context.isCancelled || isTerminalState(task.state)) return false;

    // Regla estricta de seguridad (§6.2): Bajo ninguna circunstancia se elude un DENY de Guard o un rechazo
    if (execResult.signals?.denied) {
        console.warn(`[Escalation] Acción denegada por Guard o usuario (denied). Prohibido reintentar o conmutar para eludir seguridad.`);
        await concludeTask(context, resolveFailureState(task), deps, "Operación denegada por política de seguridad (Guard).");
        return false;
    }

    // Expansión progresiva de memoria ante escalación (2 -> 5 -> 10)
    expandMemoryContext(context);

    if (context.escalations >= MAX_ESCALATIONS) {
        console.warn(`[Escalation] MAX_ESCALATIONS (${MAX_ESCALATIONS}) agotado.`);
        await concludeTask(context, resolveFailureState(task), deps, "Tope de escalaciones agotado.");
        return false;
    }

    context.escalations++;
    console.log(`[Escalation] Activando arbitraje de recuperación (${context.escalations}/${MAX_ESCALATIONS}).`);

    // Excluir la tool fallida de reintento inmediato
    if (step.tool) {
        context.excludedToolForNextCall = step.tool;
    }

    // Arbitraje migrado hacia Eos y reglas deterministas de código (Fase 3, §3, §3.1)
    try {
        const d1Arbitration = await deps.decisionEngine.evaluateDecisionOne(
            task.message,
            buildHistoryContext(task, context.memoryRetrievalLimit || 5),
            {
                allowFin: true,
                isPostAction: true,
                isFirstIteration: false,
                lastResult: context.lastCallDecisionSummary || context.lastCallCompactObs,
                attempts: buildAttempts(task),
            }
        );

        if (d1Arbitration.route !== "fin" && d1Arbitration.route !== step.route) {
            console.log(`[Escalation Eos] Arbitraje Eos determinó conmutar subsistema a '${d1Arbitration.route}' con confianza ${d1Arbitration.confidence.toFixed(2)}.`);
            context.activeServerOverride = d1Arbitration.route;
            return true;
        }

        if (d1Arbitration.route === "fin") {
            console.log(`[Escalation Eos] Arbitraje Eos determinó fin de alternativas viables.`);
            await concludeTask(context, resolveFailureState(task), deps, "Fin de alternativas viables según arbitraje de Decision 2.0.");
            return false;
        }
    } catch (eosErr) {
        console.warn(`[Escalation] Fallo en arbitraje Eos, activando conmutación determinista de respaldo:`, eosErr);
    }

    // Conmutación determinista de respaldo hacia subsistemas alternativos no fallidos
    const fallbackRoutes: StepRoute[] = ["desktop_commander", "free_search", "windows"];
    const candidateFallback = fallbackRoutes.find((r) => r !== step.route && r !== step.mcp);
    if (candidateFallback) {
        console.log(`[Escalation] Conmutación determinista de respaldo hacia '${candidateFallback}'.`);
        context.activeServerOverride = candidateFallback;
        return true;
    }

    await concludeTask(context, resolveFailureState(task), deps, "No se hallaron rutas alternativas de recuperación.");
    return false;
}

export async function handleReplan(
    context: TaskExecutionContext,
    failedStepIndex: number,
    deps: EngineDependencies
): Promise<boolean> {
    const { task } = context;

    if (context.isCancelled || isTerminalState(task.state)) return false;

    // Verificación centralizada de límite de replanificaciones
    if ((task.replans || 0) >= MAX_REPLAN) {
        console.warn(`[PLAN] MAX_REPLAN (${MAX_REPLAN}) alcanzado.`);
        await concludeTask(context, resolveFailureState(task), deps, "Límite de replanificaciones alcanzado.");
        return false;
    }

    // Expansión progresiva de memoria ante replan (2 -> 5 -> 10)
    expandMemoryContext(context);

    task.replans = (task.replans || 0) + 1;

    const failedStep = task.steps[failedStepIndex];
    console.log(`[PLAN] Activando Replan autónomo (${task.replans}/${MAX_REPLAN}) para paso '${failedStep.id}'.`);

    const completedSummary = task.steps
        .slice(0, failedStepIndex)
        .filter((s) => s.state === "COMPLETED")
        .map((s) => `[x] ${s.id} ${s.instruction} -> ${s.evidence?.summary || 'ok'}`);

    const remainingGoals = task.steps
        .slice(failedStepIndex + 1)
        .map((s) => `[ ] ${s.id} ${s.instruction}`);

    const nextIdNum = (task.stepSeq ?? 0) + 1;

    const replanResult = await deps.qwenEngine.replan({
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
        await concludeTask(context, resolveFailureState(task), deps, replanResult.reason || "Replan abortado.");
        return false;
    }

    for (let i = failedStepIndex; i < task.steps.length; i++) {
        task.steps[i].superseded = true;
    }

    const newRev = (failedStep.rev || 0) + 1;
    const newSteps: Step[] = replanResult.plan.steps.map((s, idx) => {
        const rawRoute = s.suggested_mcp || s.route;
        const safeRoute: StepRoute = isStepRoute(rawRoute) ? rawRoute : "desktop_commander";

        return {
            id: s.id || `s${nextIdNum + idx}`,
            route: safeRoute,
            instruction: s.goal || s.instruction || "Meta",
            expectedOutcome: s.expected_outcome || s.expectedOutcome,
            dependencies: Array.isArray(s.dependencies) ? s.dependencies : undefined,
            candidate_tools: Array.isArray(s.candidate_tools) ? s.candidate_tools : undefined,
            state: "PENDING" as StepState,
            calls: [],
            rev: newRev,
            superseded: false,
        };
    });

    task.steps.push(...newSteps);
    task.stepSeq = (task.stepSeq ?? 0) + newSteps.length;
    task.rawPlanInput = replanResult.rawInput;
    task.rawPlanOutput = replanResult.rawOutput;

    // Ejecución 100% autónoma: sin suspensión en WAITING_INPUT tras confirmación inicial
    deps.persistTasks();
    deps.emitEvent(task.id, "PLAN_GENERATED", {
        steps: task.steps,
        isMaterialReplan: false,
        rawInput: replanResult.rawInput,
        rawOutput: replanResult.rawOutput,
    });
    console.log(`[PLAN] Replan autónomo completado. Continuando ejecución directa de ${newSteps.length} pasos.`);
    return true;
}

// ============================================================
// FAST MODE ENGINE (§4, §8)
// ============================================================
export async function runFastLoop(
    context: TaskExecutionContext,
    deps: EngineDependencies
): Promise<void> {
    const { task } = context;

    while (!context.isCancelled && !isTerminalState(task.state)) {
        const currentStepSeq = task.stepSeq ?? 0;
        if (currentStepSeq >= MAX_STEPS) {
            console.warn(`[FAST] MAX_STEPS (${MAX_STEPS}) alcanzado. Parada controlada PARTIAL.`);
            await concludeTask(context, "PARTIAL", deps, "Límite MAX_STEPS alcanzado.");
            return;
        }

        // Step 1: Decision #1 Route
        let selectedRoute: StepRoute;
        let d1RawInput: string | undefined;
        let d1RawOutput: string | undefined;

        if (context.activeServerOverride) {
            selectedRoute = isStepRoute(context.activeServerOverride)
                ? (context.activeServerOverride as StepRoute)
                : "desktop_commander";
            context.activeServerOverride = undefined;
        } else {
            const isFirst = task.stepSeq === 0;
            const historyCtx = buildHistoryContext(task, context.memoryRetrievalLimit || 2);
            const d1 = await deps.decisionEngine.evaluateDecisionOne(
                task.message,
                historyCtx,
                {
                    allowFin: true,
                    isPostAction: context.nonReadCounter > 0,
                    isFirstIteration: isFirst,
                    lastResult: context.lastCallDecisionSummary || context.lastCallCompactObs,
                    attempts: buildAttempts(task),
                }
            );

            d1RawInput = d1.rawInput;
            d1RawOutput = d1.rawOutput;

            deps.emitEvent(task.id, "DECISION_ONE", {
                route: d1.route,
                confidence: d1.confidence,
                probabilities: d1.probabilities,
                needsContext: d1.needsContext,
                rawInput: d1.rawInput,
                rawOutput: d1.rawOutput,
            });

            // Si Decision #1 señala necesidad de contexto adicional, expandir progresivamente (2 -> 5 -> 10)
            if (d1.needsContext) {
                expandMemoryContext(context);
            }

            if (d1.route === "fin") {
                if (isFirst) {
                    console.log(`[FAST] Conversación directa (fin inicial). Concluyendo directo.`);
                    await concludeTask(context, "COMPLETED", deps);
                    return;
                }

                const hasSuccessfulTool = task.steps.some((s) => s.calls && s.calls.some((c) => c.outcome?.success));
                const hasPendingUnverified = task.steps.some((s) => s.calls && s.calls.some((c) => c.verification === "UNVERIFIED"));

                if (hasSuccessfulTool && !hasPendingUnverified) {
                    console.log(`[FAST] fin validado. Concluyendo con éxito.`);
                    await concludeTask(context, "COMPLETED", deps);
                    return;
                } else {
                    console.warn(`[FAST] fin rechazado por validación de Core. Redirigiendo a mejor ruta.`);
                    addFailEntry(context, "fin rechazado: faltan acciones verificadas previas");
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
            rawInput: d1RawInput,
            rawOutput: d1RawOutput,
        };

        task.steps.push(step);
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_STATE_CHANGED", { step, stepIndex, state: "RUNNING" }, step.id);

        // Execute single call con motor unificado runStep
        let execResult: StepExecutionResult;
        try {
            execResult = await runStep(context, step, deps);
        } catch (err: any) {
            console.error(`[FAST] Excepción no controlada en runStep:`, err);
            step.state = "FAILED";
            step.error = err?.message || String(err);
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

            const syntheticResult: StepExecutionResult = {
                status: "logical_error",
                step,
                error: step.error,
                signals: { exception: true },
            };

            const shouldContinue = await handleEscalation(context, step, syntheticResult, deps);
            if (!shouldContinue) {
                return;
            }
            continue;
        }

        if (execResult.status === "ok") {
            step.state = "COMPLETED";
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
        } else if (execResult.status === "unverified") {
            step.state = "UNVERIFIED";
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
            console.warn(`[FAST] Acción UNVERIFIED registrada. Requiere observación.`);
        } else if (execResult.status === "blocked_loop") {
            step.state = "BLOCKED";
            step.error = execResult.error || "Invocación bloqueada por anti-loop.";
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

            if (context.consecutiveLoopBlocks >= 2) {
                console.warn(`[FAST] 2 bloqueos seguidos de anti-loop. Cerrando PARTIAL.`);
                await concludeTask(context, "PARTIAL", deps, "Detenido por anti-loop (2 bloqueos seguidos).");
                return;
            }
        } else {
            step.state = "FAILED";
            step.error = execResult.error || "Fallo lógico en ejecución.";
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

            const shouldContinue = await handleEscalation(context, step, execResult, deps);
            if (!shouldContinue) {
                return;
            }
        }
    }
}

// ============================================================
// PLAN MODE ENGINE (§9)
// ============================================================
export async function initiatePlanMode(
    context: TaskExecutionContext,
    deps: EngineDependencies
): Promise<void> {
    const { task } = context;

    if (context.isCancelled || isTerminalState(task.state)) return;

    const d1Initial = await deps.decisionEngine.evaluateDecisionOne(
        task.message,
        buildHistoryContext(task, context.memoryRetrievalLimit || 2),
        {
            allowFin: true,
            isFirstIteration: true,
        }
    );

    if (context.isCancelled || isTerminalState(task.state)) return;

    if (d1Initial.route === "fin") {
        console.log(`[PLAN] Objetivo clasificado como conversación directa (fin por argmax). Concluyendo directo.`);
        await concludeTask(context, "COMPLETED", deps);
        return;
    }

    let plan;
    try {
        plan = await deps.qwenEngine.generatePlan(task.message, undefined, context.abortController.signal);
    } catch (err: any) {
        if (context.isCancelled || isTerminalState(task.state)) {
            RefStore.clear(task.id);
            return;
        }
        task.state = "FAILED";
        RefStore.clear(task.id);
        deps.persistTasks();
        deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "FAILED", error: `Plan inválido: ${err.message}` });
        return;
    }

    if (context.isCancelled || isTerminalState(task.state)) {
        RefStore.clear(task.id);
        return;
    }

    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
        task.state = "FAILED";
        RefStore.clear(task.id);
        deps.persistTasks();
        deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "FAILED", error: "Plan inválido en único intento." });
        return;
    }

    task.steps = plan.steps.slice(0, MAX_STEPS).map((s, idx) => ({
        id: s.id || `s${idx + 1}`,
        route: isStepRoute(s.suggested_mcp) ? s.suggested_mcp : (isStepRoute(s.route) ? s.route : "desktop_commander"),
        instruction: s.goal || s.instruction || "Objetivo",
        expectedOutcome: s.expected_outcome || s.expectedOutcome,
        dependencies: Array.isArray(s.dependencies) ? s.dependencies : undefined,
        candidate_tools: Array.isArray(s.candidate_tools) ? s.candidate_tools : undefined,
        state: "PENDING" as StepState,
        calls: [],
        rev: 0,
        superseded: false,
    }));

    task.stepSeq = task.steps.length;
    task.planConfirmed = false;
    task.rawPlanInput = plan.rawInput;
    task.rawPlanOutput = plan.rawOutput;
    task.state = "WAITING_INPUT";
    task.waitingReason = "plan_confirmation";
    deps.persistTasks();
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

    while (!context.isCancelled && !isTerminalState(task.state) && (task.state as TaskState) !== "WAITING_INPUT") {
        const stepIndex = task.steps.findIndex((s) => !s.superseded && (s.state === "PENDING" || s.state === "RUNNING"));
        if (stepIndex === -1) {
            console.log(`[PLAN] Todos los pasos completados. Concluyendo tarea.`);
            await concludeTask(context, "COMPLETED", deps);
            return;
        }

        task.currentStep = stepIndex;
        const step = task.steps[stepIndex];

        // Verificación determinista de dependencias de etapa (Fase 4, §3.2.5, §6.2)
        if (step.dependencies && step.dependencies.length > 0) {
            const brokenDep = step.dependencies.find((depId) => {
                const found = task.steps.find((s) => s.id === depId);
                return !found || found.state !== "COMPLETED";
            });
            if (brokenDep) {
                console.warn(`[PLAN] Dependencia '${brokenDep}' del paso '${step.id}' no satisfecha. Activando replanificación autónoma.`);
                step.state = "FAILED";
                step.error = `Dependencia previa '${brokenDep}' no completada con éxito.`;
                deps.persistTasks();
                deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

                if (!await handleReplan(context, stepIndex, deps)) {
                    return;
                }
                continue;
            }
        }

        step.state = "RUNNING";
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_STATE_CHANGED", { step, stepIndex, state: "RUNNING" }, step.id);

        // Fase 3B: Entrega directa de la etapa a FAST (runStep) sin duplicar ejecución
        let execResult: StepExecutionResult;
        try {
            execResult = await runStep(context, step, deps);
        } catch (err: any) {
            console.error(`[PLAN] Excepción no controlada en runStep:`, err);
            step.state = "FAILED";
            step.error = err?.message || String(err);
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

            if (!await handleReplan(context, stepIndex, deps)) {
                return;
            }
            continue;
        }

        if (context.isCancelled || isTerminalState(task.state) || (task.state as TaskState) === "WAITING_INPUT") {
            return;
        }

        // Regla estricta de seguridad (§3.2.7 y §6.2): si el paso fue denegado por Guard o por el usuario, PROHIBIDO replanificar
        if (execResult.signals?.denied || (step.state as StepState) === "BLOCKED") {
            console.warn(`[PLAN] Acción denegada por Guard o usuario. Prohibido replanificar para eludir denegación.`);
            await concludeTask(context, resolveFailureState(task), deps, "Operación denegada por política de seguridad (Guard).");
            return;
        }

        // Supervisión y Verificación por Etapa con Qwen (Fase 3B, §3.2.6)
        if (execResult.status === "ok") {
            const expectedOutcome = step.expectedOutcome || "Cumplimiento del objetivo de la etapa";
            const evidenceSummary = execResult.call?.evidence?.summary || execResult.call?.evidence?.obs || "";
            const compactObs = context.lastCallCompactObs || "";
            const eosOk = execResult.call?.evidence?.ok ?? true;
            const eosCumple = (execResult.call?.evidence as any)?.cumple ?? execResult.call?.outcome?.success ?? true;

            const stageVerif = await deps.qwenEngine.verifyStage({
                goal: task.message,
                stepInstruction: step.instruction,
                expectedOutcome,
                evidenceSummary,
                compactObs,
                facts: task.memory?.facts || {},
                eosOk,
                eosCumple,
                logLines: task.memory?.log || [],
            }, context.abortController.signal);

            step.rawInput = stageVerif.rawInput;
            step.rawOutput = stageVerif.rawOutput;

            deps.emitEvent(task.id, "STAGE_VERIFIED", {
                stepId: step.id,
                stageVerification: stageVerif,
                eosOk,
                eosCumple,
                rawInput: stageVerif.rawInput,
                rawOutput: stageVerif.rawOutput,
            }, step.id);

            console.log(`[PLAN StageVerification] step=${step.id} status=${stageVerif.status} reason=${stageVerif.reason}`);

            if (stageVerif.status === "completed") {
                step.state = "COMPLETED";
                deps.persistTasks();
                deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
                continue;
            } else if (stageVerif.status === "insufficient_info") {
                task.state = "WAITING_INPUT";
                task.waitingReason = "user_answer";
                step.state = "UNVERIFIED";
                step.error = stageVerif.reason;
                deps.persistTasks();
                deps.emitEvent(task.id, "TASK_STATE_CHANGED", {
                    state: "WAITING_INPUT",
                    waitingReason: "user_answer",
                    question: stageVerif.questionForUser || stageVerif.reason,
                });
                console.log(`[PLAN] Información insuficiente en etapa '${step.id}'. Suspendido en WAITING_INPUT sin timers.`);
                return;
            } else if (stageVerif.status === "unrecoverable_blocked") {
                step.state = "BLOCKED";
                step.error = stageVerif.reason;
                deps.persistTasks();
                deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);
                await concludeTask(context, resolveFailureState(task), deps, stageVerif.reason);
                return;
            } else {
                // recoverable_deviation:
                step.state = "FAILED";
                step.error = stageVerif.reason;
                deps.persistTasks();
                deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

                if (!await handleReplan(context, stepIndex, deps)) {
                    return;
                }
                continue;
            }
        } else if (execResult.status === "unverified") {
            step.state = "UNVERIFIED";
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
            console.log(`[PLAN] Paso ${step.id} registrado como UNVERIFIED. Continuando hacia la siguiente etapa.`);
            continue;
        } else {
            // execResult.status === "logical_error" | "blocked_loop"
            step.state = "FAILED";
            step.error = execResult.error || "Fallo en ejecución del paso.";
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

            if (!await handleReplan(context, stepIndex, deps)) {
                return;
            }
            continue;
        }
    }
}