/**
 * JARVIS Core — Execution Mode Engines (FAST, PLAN, Replan, Escalation)
 */

import {
    TaskState,
    Step,
    StepState,
    StepRoute,
    MAX_STEPS,
    MAX_TOOL_CALLS_PER_STEP,
    MAX_TOOL_CALLS_TASK,
    MAX_ESCALATIONS,
    MAX_REPLAN,
    DECISION_MIN_CONFIDENCE,
    StepExecutionResult,
    EscalationResponse,
} from "./types.ts";
import { RefStore } from "./processor/resultProcessor.ts";
import {
    TaskExecutionContext,
    addFailEntry,
    buildHistoryContext,
    buildAttempts,
} from "./context.ts";
import {
    EngineDependencies,
    executeCall,
} from "./callExecutor.ts";
import { isStepRoute } from "./reasoner/qwen.ts";

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

    try {
        task.finalResponse = await deps.qwenEngine.generateFinalResponse({
            goal: task.message,
            logLines: task.memory?.log || [],
            facts: task.memory?.facts || {},
            failLines: task.memory?.fail || [],
            evidenceSummaries,
            abortReason,
        }, context.abortController.signal);
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

    // Limpieza exclusiva de las referencias de esta tarea
    RefStore.clear(task.id);
    deps.persistTasks();
    const durationTotalMs = Date.now() - context.startTime;
    console.log(
        `[Task Summary] id=${task.id} state=${state} reason="${abortReason || 'None'}" calls=${context.totalToolCalls} escalations=${context.escalations} overrides=${context.overridesCount} retries=${context.retriesCount} duration=${durationTotalMs}ms`
    );
    deps.emitEvent(task.id, "FINAL_RESPONSE", { response: task.finalResponse });
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

    if (context.escalations >= MAX_ESCALATIONS) {
        console.warn(`[Escalation] MAX_ESCALATIONS (${MAX_ESCALATIONS}) agotado.`);
        const hasCompleted = task.steps.some((s) => s.state === "COMPLETED");
        await concludeTask(context, hasCompleted ? "PARTIAL" : "FAILED", deps, "Tope de escalaciones agotado.");
        return false;
    }

    context.escalations++;
    console.log(`[Escalation] Activando Etapa 5B (${context.escalations}/${MAX_ESCALATIONS}).`);

    const escResp: EscalationResponse = await deps.qwenEngine.escalate({
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
        await concludeTask(context, hasCompleted ? "PARTIAL" : "FAILED", deps, escResp.reason);
        return false;
    }

    if (escResp.action === "switch_mcp" && escResp.mcp) {
        const targetMcp = escResp.mcp.toLowerCase();
        console.log(`[Escalation] Qwen solicitó switch_mcp a '${targetMcp}'. Razón: ${escResp.reason}`);
        context.activeServerOverride = isStepRoute(targetMcp) ? targetMcp : "desktop_commander";
        if (context.activeServerOverride === step.mcp && step.tool) {
            context.excludedToolForNextCall = step.tool;
        }
        return true;
    }

    return false;
}

export async function handleReplan(
    context: TaskExecutionContext,
    failedStepIndex: number,
    deps: EngineDependencies
): Promise<boolean> {
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
        const hasCompleted = task.steps.some((s) => s.state === "COMPLETED");
        await concludeTask(context, hasCompleted ? "PARTIAL" : "FAILED", deps, replanResult.reason || "Replan abortado.");
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
            state: "PENDING" as StepState,
            calls: [],
            rev: newRev,
            superseded: false,
        };
    });

    task.steps.push(...newSteps);
    task.stepSeq = (task.stepSeq ?? 0) + newSteps.length;
    deps.persistTasks();
    deps.emitEvent(task.id, "PLAN_GENERATED", { steps: task.steps });
    console.log(`[PLAN] Replan completado. ${newSteps.length} pasos nuevos agregados.`);
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

    while (!context.isCancelled) {
        const currentStepSeq = task.stepSeq ?? 0;
        if (currentStepSeq >= MAX_STEPS) {
            console.warn(`[FAST] MAX_STEPS (${MAX_STEPS}) alcanzado. Parada controlada PARTIAL.`);
            await concludeTask(context, "PARTIAL", deps, "Límite MAX_STEPS alcanzado.");
            return;
        }

        if (context.totalToolCalls >= MAX_TOOL_CALLS_TASK) {
            console.warn(`[FAST] MAX_TOOL_CALLS_TASK (${MAX_TOOL_CALLS_TASK}) alcanzado.`);
            await concludeTask(context, "PARTIAL", deps, "Límite MAX_TOOL_CALLS_TASK alcanzado.");
            return;
        }

        // Step 1: Decision #1 Route
        let selectedRoute: StepRoute;
        if (context.activeServerOverride) {
            selectedRoute = isStepRoute(context.activeServerOverride)
                ? (context.activeServerOverride as StepRoute)
                : "desktop_commander";
            context.activeServerOverride = undefined;
        } else {
            const isFirst = task.stepSeq === 0;
            const d1 = await deps.decisionEngine.evaluateDecisionOne(
                task.message,
                buildHistoryContext(task),
                {
                    allowFin: true,
                    isPostAction: context.nonReadCounter > 0,
                    isFirstIteration: isFirst,
                    lastResult: context.lastCallDecisionSummary || context.lastCallCompactObs,
                    attempts: buildAttempts(task),
                }
            );

            deps.emitEvent(task.id, "DECISION_ONE", {
                route: d1.route,
                confidence: d1.confidence,
                probabilities: d1.probabilities,
                needsContext: d1.needsContext,
            });

            if (d1.route === "fin") {
                if (isFirst) {
                    console.log(`[FAST] Conversación directa (fin inicial). Respondiendo directo.`);
                    const finalResp = await deps.qwenEngine.generateFinalResponse({
                        goal: task.message,
                        logLines: [],
                        facts: task.memory?.facts || {},
                        failLines: [],
                        evidenceSummaries: [],
                    }, context.abortController.signal);

                    task.finalResponse = finalResp;
                    task.state = "COMPLETED";
                    RefStore.clear(task.id);
                    deps.persistTasks();
                    deps.emitEvent(task.id, "FINAL_RESPONSE", { response: finalResp });
                    deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "COMPLETED" });
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
        };

        task.steps.push(step);
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);

        // Execute single call con captura garantizada de excepciones
        let execResult: StepExecutionResult;
        try {
            execResult = await executeCall(context, step, deps);
        } catch (err: any) {
            console.error(`[FAST] Excepción no controlada en executeCall:`, err);
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
            if (context.consecutiveLoopBlocks >= 2) {
                console.warn(`[FAST] 2 bloqueos seguidos de anti-loop. Cerrando PARTIAL.`);
                step.state = "FAILED";
                step.error = "Bloqueos repetidos por anti-loop.";
                await concludeTask(context, "PARTIAL", deps, "Detenido por anti-loop (2 bloqueos seguidos).");
                return;
            }
        } else {
            step.state = "FAILED";
            step.error = execResult.error || "Fallo lógico en ejecución.";
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, error: step.error }, step.id);

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

    const d1Initial = await deps.decisionEngine.evaluateDecisionOne(task.message, [], {
        allowFin: true,
        isFirstIteration: true,
    });

    if (d1Initial.route === "fin" && d1Initial.confidence >= DECISION_MIN_CONFIDENCE) {
        console.log(`[PLAN] Objetivo clasificado como conversación directa (fin). Respondiendo sin plan.`);
        const finalResp = await deps.qwenEngine.generateFinalResponse({
            goal: task.message,
            logLines: [],
            facts: {},
            failLines: [],
            evidenceSummaries: [],
        }, context.abortController.signal);

        task.finalResponse = finalResp;
        task.state = "COMPLETED";
        RefStore.clear(task.id);
        deps.persistTasks();
        deps.emitEvent(task.id, "FINAL_RESPONSE", { response: finalResp });
        deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "COMPLETED" });
        return;
    }

    let plan;
    try {
        plan = await deps.qwenEngine.generatePlan(task.message, undefined, context.abortController.signal);
    } catch (err: any) {
        task.state = "FAILED";
        RefStore.clear(task.id);
        deps.persistTasks();
        deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "FAILED", error: `Plan inválido: ${err.message}` });
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
        state: "PENDING" as StepState,
        calls: [],
        rev: 0,
        superseded: false,
    }));

    task.stepSeq = task.steps.length;
    task.planConfirmed = false;
    deps.persistTasks();
    deps.emitEvent(task.id, "PLAN_GENERATED", { steps: task.steps });
    console.log(`[PLAN] Plan generado con ${task.steps.length} pasos. Esperando confirmación.`);
}

export async function runPlanLoop(
    context: TaskExecutionContext,
    deps: EngineDependencies
): Promise<void> {
    const { task } = context;

    while (!context.isCancelled) {
        if (context.totalToolCalls >= MAX_TOOL_CALLS_TASK) {
            console.warn(`[PLAN] MAX_TOOL_CALLS_TASK (${MAX_TOOL_CALLS_TASK}) alcanzado. Parada controlada PARTIAL.`);
            await concludeTask(context, "PARTIAL", deps, "Límite MAX_TOOL_CALLS_TASK alcanzado.");
            return;
        }

        const stepIndex = task.steps.findIndex((s) => !s.superseded && (s.state === "PENDING" || s.state === "RUNNING"));
        if (stepIndex === -1) {
            console.log(`[PLAN] Todos los pasos completados. Concluyendo tarea.`);
            await concludeTask(context, "COMPLETED", deps);
            return;
        }

        task.currentStep = stepIndex;
        const step = task.steps[stepIndex];
        step.state = "RUNNING";
        deps.persistTasks();
        deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);

        let stepCompleted = false;
        let stepCalls = 0;

        while (stepCalls < MAX_TOOL_CALLS_PER_STEP && !stepCompleted && !context.isCancelled) {
            stepCalls++;

            let execResult: StepExecutionResult;
            try {
                execResult = await executeCall(context, step, deps);
            } catch (err: any) {
                console.error(`[PLAN] Excepción no controlada en executeCall:`, err);
                step.state = "FAILED";
                step.error = err?.message || String(err);
                deps.persistTasks();
                deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);
                break;
            }

            if (execResult.status === "ok") {
                if (step.expectedOutcome) {
                    const extract = execResult.call?.evidence?.summary || "";
                    const judgement = await deps.decisionEngine.evaluatePlanJudgement(
                        step.expectedOutcome,
                        execResult.call?.evidence?.summary || "",
                        extract
                    );

                    if (judgement.met) {
                        stepCompleted = true;
                        step.state = "COMPLETED";
                        deps.persistTasks();
                        deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
                        break;
                    } else {
                        console.log(`[PLAN Judgement] Criterio no cumplido aún. Continuando mini-loop.`);
                    }
                } else {
                    stepCompleted = true;
                    step.state = "COMPLETED";
                    deps.persistTasks();
                    deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
                    break;
                }
            } else if (execResult.status === "unverified") {
                step.state = "UNVERIFIED";
                deps.persistTasks();
                deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex }, step.id);
                break;
            } else if (execResult.status === "blocked_loop") {
                break;
            } else {
                break;
            }
        }

        if (!stepCompleted && !context.isCancelled) {
            if (step.state === "UNVERIFIED") {
                console.log(`[PLAN] Paso ${step.id} registrado como UNVERIFIED. Continuando hacia el siguiente paso.`);
                continue;
            }

            step.state = "FAILED";
            step.error = step.error || "Paso falló o agotó calls sin cumplir criterio.";
            deps.persistTasks();
            deps.emitEvent(task.id, "STEP_COMPLETED", { step, stepIndex, error: step.error }, step.id);

            if ((task.replans || 0) >= MAX_REPLAN) {
                console.warn(`[PLAN] MAX_REPLAN (${MAX_REPLAN}) alcanzado.`);
                await concludeTask(context, "PARTIAL", deps, "Límite de replanes alcanzado.");
                return;
            }

            const replanSuccess = await handleReplan(context, stepIndex, deps);
            if (!replanSuccess) {
                return;
            }
        }
    }
}