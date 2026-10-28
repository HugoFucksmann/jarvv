/**
 * JARVIS Core — Execution Mode Engines (FAST, PLAN, Replan, Escalation)
 */

import {
    MAX_ESCALATIONS,
    MAX_REPLAN,
    MAX_STEPS,
    MAX_USER_QUESTIONS_PER_STEP,
    type DecisionOneResult,
    type ExecutableRoute,
    type Plan,
    type PlanStep,
    type ReplanResult,
    type StageVerificationResult,
    type Step,
    type StepExecutionResult,
    type StepRoute,
} from "./types.ts";
import {
    type TaskExecutionContext,
    buildAttempts,
    buildHistoryContext,
    expandMemoryContext,
    hasUnresolvedUnverified,
    isStopped,
    recordFailure,
} from "./context.ts";
import type { EngineDependencies } from "./engineDeps.ts";
import { recordFailedCall, runStep } from "./callExecutor.ts";
import { LLMServiceUnavailableError } from "./reasoner/qwen.ts";
import { DecisionServiceUnavailableError } from "./decision.ts";
import { sanitizeForMemory } from "./processor/text.ts";
import { emitStepCompleted, emitStepError, emitStepRunning } from "./stepEvents.ts";
import {
    buildAllEffects,
    concludeAsFailure,
    concludeOnLLMError,
    concludeTask,
    failTask,
    isCancellation,
    resolveIncompleteState,
} from "./taskConclusion.ts";
import { errorMessage } from "./utils.ts";

const MAX_CONSECUTIVE_LOOP_BLOCKS = 2;
const GUARD_DENIED_REASON = "Operación denegada por política de seguridad (Guard).";
/** Motivo fijo de detención cuando la verificación semántica declara un paso irrecuperable (nunca el `reason` del modelo). */
const UNRECOVERABLE_BLOCKED_REASON = "La verificación semántica determinó que la etapa no puede completarse.";

/**
 * Compara el estado leyéndolo de nuevo en cada llamada. Tras asignar `step.state = "RUNNING"`, TypeScript asume ese
 * valor aunque `runStep` (que corre en medio de un `await`) lo cambie; una comparación directa daría un falso error.
 */
const hasState = <S extends string>(entity: { state: S }, state: S): boolean => entity.state === state;

/** Decision #1 con allowFin=false solo puede devolver rutas ejecutables. */
function toExecutableRoute(route: StepRoute): ExecutableRoute {
    if (route === "fin") {
        throw new Error("Decision #1 devolvió 'fin' con allowFin=false.");
    }
    return route;
}

/** Sin valores por defecto: ruta y criterio de éxito ya vienen validados de qwen.ts. */
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


// DECISION & STEP EVENTS

/** Decision #1 sobre el estado actual de la tarea. */
function askDecisionOne(context: TaskExecutionContext, deps: EngineDependencies, allowFin: boolean) {
    const { task } = context;
    return deps.decisionEngine.evaluateDecisionOne(
        task.message,
        buildHistoryContext(task, context.memoryRetrievalLimit),
        {
            allowFin,
            lastResult: context.lastCallDecisionSummary || context.lastCallCompactObs,
            attempts: buildAttempts(task),
            signal: context.abortController.signal,
        }
    );
}

function emitDecisionOne(
    deps: EngineDependencies,
    taskId: string,
    decision: DecisionOneResult,
    purpose?: "escalation" | "reselection"
): void {
    deps.emitEvent(taskId, "DECISION_ONE", {
        route: decision.route,
        probabilities: decision.probabilities,
        rawInput: decision.rawInput,
        rawOutput: decision.rawOutput,
        timing: decision.timing,
        ...(purpose ? { purpose } : {}),
    });
}

/** Fallo no controlado de runStep: marca el paso FAILED, registra la llamada fallida y emite STEP_COMPLETED. */
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
    step.error = errorMessage(err);
    const unavailable = err instanceof LLMServiceUnavailableError || err instanceof DecisionServiceUnavailableError;
    const subject = step.tool ?? step.route;
    if (unavailable) {
        recordFailure(context, "service_unavailable", { stepId: step.id, subject });
        context.lastHandoff = undefined;
        context.lastCallDecisionSummary = `[FAILURE] ${subject}: ${sanitizeForMemory(step.error, 120)}.`;
    } else {
        recordFailedCall(context, step, { status: "exception", error: step.error });
    }
    emitStepError(deps, context.task.id, step, stepIndex);
}


/** Resultado de ejecutar un paso: su resultado, una excepción ya registrada en el paso, o la cancelación de la tarea. */
type GuardedRun =
    | { kind: "result"; result: StepExecutionResult }
    | { kind: "crashed" }
    | { kind: "cancelled" };

/**
 * `runStep` para un paso de FAST o PLAN. La cancelación termina el bucle; cualquier otra excepción se registra en el
 * paso (recordStepCrash) y cada modo decide cómo recuperarse (escalación en FAST, replan en PLAN).
 */
async function runStepGuarded(
    context: TaskExecutionContext,
    step: Step,
    stepIndex: number,
    deps: EngineDependencies,
    loopTag: "FAST" | "PLAN"
): Promise<GuardedRun> {
    try {
        return { kind: "result", result: await runStep(context, step, deps) };
    } catch (err) {
        if (isCancellation(context, err)) return { kind: "cancelled" };
        recordStepCrash(context, step, stepIndex, deps, loopTag, err);
        return { kind: "crashed" };
    }
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
        await concludeAsFailure(context, deps, GUARD_DENIED_REASON);
        return false;
    }

    expandMemoryContext(context);

    if (context.escalations >= MAX_ESCALATIONS) {
        console.warn(`[Escalation] MAX_ESCALATIONS (${MAX_ESCALATIONS}) agotado.`);
        await concludeAsFailure(context, deps, "Tope de escalaciones agotado.");
        return false;
    }

    context.escalations++;
    task.escalations = context.escalations;
    console.log(`[Escalation] Activando arbitraje de recuperación (${context.escalations}/${MAX_ESCALATIONS}).`);

    // La tool fallida no se reintenta de inmediato.
    if (step.tool) {
        context.excludedToolForNextCall = step.tool;
    }

    let arbitration: DecisionOneResult;
    try {
        arbitration = await askDecisionOne(context, deps, true);
    } catch (err) {
        return concludeOnLLMError(context, deps, "Arbitraje de recuperación (Decision #1)", err);
    }

    emitDecisionOne(deps, task.id, arbitration, "escalation");

    if (arbitration.route === "fin") {
        console.log(`[Escalation] Decision #1 determinó fin de alternativas viables.`);
        await concludeAsFailure(context, deps, "Fin de alternativas viables según arbitraje de Decision 2.0.");
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
        await concludeAsFailure(context, deps, "Límite de replanificaciones alcanzado.");
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

    let replanResult: ReplanResult;
    try {
        replanResult = await deps.llm.replan({
            goal: task.message,
            completedStepsSummary: completedSummary,
            facts: task.memory?.facts || {},
            failLines: task.memory?.fail || [],
            logLines: task.memory?.log || [],
            // Las mutaciones ya aplicadas no se deshacen con la verificación: el replan debe conocerlas.
            effects: buildAllEffects(task),
            failedStepGoal: failedStep.instruction,
            failedStepResult: failedStep.error || "error",
            remainingPlanGoals: remainingGoals,
            nextStepNumber: (task.stepSeq ?? 0) + 1,
        }, context.abortController.signal);
    } catch (err) {
        return concludeOnLLMError(context, deps, "Replan", err);
    }

    if (isStopped(context)) return false;

    if (replanResult.action === "abort" || !replanResult.plan) {
        console.log(`[PLAN Replan] Replan devolvió abort: ${replanResult.reason}`);
        await concludeAsFailure(context, deps, replanResult.reason || "Replan abortado.");
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

    deps.emitEvent(task.id, "PLAN_GENERATED", {
        steps: task.steps,
        replan: true,
        isMaterialReplan: false,
        rawInput: replanResult.rawInput,
        rawOutput: replanResult.rawOutput,
        timing: replanResult.timing,
    });
    console.log(`[PLAN] Replan autónomo completado. Continuando ejecución directa de ${newSteps.length} pasos.`);
    return true;
}


// FAST MODE ENGINE

/**
 * Ruta de la siguiente iteración: la impuesta por la escalación o la que elige Decision #1.
 * Devuelve undefined si la tarea ya quedó concluida y el bucle debe terminar.
 */
async function selectRoute(context: TaskExecutionContext, deps: EngineDependencies): Promise<ExecutableRoute | undefined> {
    const { task } = context;

    if (context.activeRouteOverride) {
        const route = context.activeRouteOverride;
        context.activeRouteOverride = undefined;
        return route;
    }

    const isFirst = task.stepSeq === 0;
    let d1: DecisionOneResult;
    try {
        d1 = await askDecisionOne(context, deps, true);
    } catch (err) {
        await concludeOnLLMError(context, deps, "Decision #1", err);
        return undefined;
    }

    emitDecisionOne(deps, task.id, d1);

    if (d1.route !== "fin") return d1.route;

    if (isFirst) {
        console.log(`[FAST] Conversación directa (fin inicial). Concluyendo directo.`);
        await concludeTask(context, "COMPLETED", deps);
        return undefined;
    }

    const hasSuccessfulTool = task.steps.some((s) => s.calls?.some((c) => c.outcome?.success));
    if (hasSuccessfulTool && !hasUnresolvedUnverified(task)) {
        console.log(`[FAST] fin validado. Concluyendo con éxito.`);
        await concludeTask(context, "COMPLETED", deps);
        return undefined;
    }

    console.warn(`[FAST] fin rechazado por validación de Core. Solicitando mejor ruta ejecutable.`);
    recordFailure(context, "fin_rejected", { subject: "fin" });
    try {
        const alt = await askDecisionOne(context, deps, false);
        const route = toExecutableRoute(alt.route);
        emitDecisionOne(deps, task.id, alt, "reselection");
        return route;
    } catch (err) {
        await concludeOnLLMError(context, deps, "Decision #1 (reselección tras fin rechazado)", err);
        return undefined;
    }
}

/**
 * Aplica el resultado de `runStep` al paso FAST. Devuelve false si la tarea quedó concluida y el bucle debe terminar.
 */
async function settleFastStep(
    context: TaskExecutionContext,
    step: Step,
    stepIndex: number,
    execResult: StepExecutionResult,
    deps: EngineDependencies
): Promise<boolean> {
    const taskId = context.task.id;

    switch (execResult.status) {
        case "ok":
            step.state = "COMPLETED";
            emitStepCompleted(deps, taskId, step, stepIndex);
            return true;

        case "unverified":
            step.state = "UNVERIFIED";
            emitStepCompleted(deps, taskId, step, stepIndex);
            console.warn(`[FAST] Acción UNVERIFIED registrada. Requiere observación.`);
            return true;

        case "blocked_loop":
            step.state = "BLOCKED";
            step.error = execResult.error || "Invocación bloqueada por anti-loop.";
            emitStepError(deps, taskId, step, stepIndex);

            if (context.consecutiveLoopBlocks >= MAX_CONSECUTIVE_LOOP_BLOCKS) {
                console.warn(`[FAST] ${MAX_CONSECUTIVE_LOOP_BLOCKS} bloqueos seguidos de anti-loop. Cerrando PARTIAL.`);
                await concludeTask(context, "PARTIAL", deps, `Detenido por anti-loop (${MAX_CONSECUTIVE_LOOP_BLOCKS} bloqueos seguidos).`);
                return false;
            }
            return true;

        case "logical_error":
            step.state = "FAILED";
            step.error = execResult.error || "Fallo lógico en ejecución.";
            emitStepError(deps, taskId, step, stepIndex);
            return handleEscalation(context, step, execResult, deps);
    }
}

export async function runFastLoop(
    context: TaskExecutionContext,
    deps: EngineDependencies
): Promise<void> {
    const { task } = context;

    while (!isStopped(context)) {
        if ((task.stepSeq ?? 0) >= MAX_STEPS) {
            console.warn(`[FAST] MAX_STEPS (${MAX_STEPS}) alcanzado. Parada controlada PARTIAL.`);
            await concludeTask(context, "PARTIAL", deps, "Límite MAX_STEPS alcanzado.");
            return;
        }

        const selectedRoute = await selectRoute(context, deps);
        if (selectedRoute === undefined || isStopped(context)) return;

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
        emitStepRunning(deps, task.id, step, stepIndex);

        const run = await runStepGuarded(context, step, stepIndex, deps, "FAST");
        if (run.kind === "cancelled") return;

        if (run.kind === "crashed") {
            const crashResult: StepExecutionResult = { status: "logical_error", step, error: step.error };
            if (!await handleEscalation(context, step, crashResult, deps)) {
                return;
            }
            continue;
        }

        if (!await settleFastStep(context, step, stepIndex, run.result, deps)) {
            return;
        }
    }
}


// PLAN MODE ENGINE

export async function initiatePlanMode(
    context: TaskExecutionContext,
    deps: EngineDependencies
): Promise<void> {
    const { task } = context;

    if (isStopped(context)) return;

    let plan: Plan;
    try {
        plan = await deps.llm.generatePlan(task.message, context.abortController.signal);
    } catch (err) {
        if (isCancellation(context, err)) return;
        console.error(`[PLAN] Plan inválido:`, errorMessage(err));
        failTask(context, deps, new Error(`Plan inválido: ${errorMessage(err)}`));
        return;
    }

    if (isStopped(context)) return;

    task.rawPlanInput = plan.rawInput;
    task.rawPlanOutput = plan.rawOutput;

    if (plan.steps.length === 0) {
        console.log(`[PLAN] El plan no requiere herramientas. Concluyendo con respuesta directa.`);
        await concludeTask(context, "COMPLETED", deps);
        return;
    }

    task.steps = planStepsToSteps(plan.steps, 0);
    task.stepSeq = task.steps.length;
    task.planConfirmed = false;
    task.state = "WAITING_INPUT";
    task.waitingReason = "plan_confirmation";
    deps.emitEvent(task.id, "PLAN_GENERATED", {
        steps: task.steps,
        rawInput: plan.rawInput,
        rawOutput: plan.rawOutput,
        timing: plan.timing,
    });
    deps.emitEvent(task.id, "TASK_STATE_CHANGED", { state: "WAITING_INPUT", waitingReason: "plan_confirmation" });
    console.log(`[PLAN] Plan generado con ${task.steps.length} pasos. Esperando confirmación inicial en WAITING_INPUT.`);
}

/** Cierre de un plan sin pasos ejecutables: COMPLETED solo si todos los pasos vigentes están COMPLETED. */
async function concludeExhaustedPlan(context: TaskExecutionContext, deps: EngineDependencies): Promise<void> {
    const { task } = context;
    const unresolved = task.steps.filter((s) => !s.superseded && s.state !== "COMPLETED");
    if (unresolved.length === 0) {
        console.log(`[PLAN] Todos los pasos completados. Concluyendo tarea.`);
        await concludeTask(context, "COMPLETED", deps);
        return;
    }
    const detail = unresolved.map((s) => `${s.id}=${s.state}`).join(", ");
    console.warn(`[PLAN] Sin pasos ejecutables pero con pasos sin resolver (${detail}). No se declara COMPLETED.`);
    await concludeTask(context, resolveIncompleteState(task), deps, `Pasos sin resolver o sin verificar: ${detail}.`);
}

/** Suspende la tarea con una pregunta al usuario; provideUserAnswer reabre el paso. */
function suspendForUserAnswer(
    context: TaskExecutionContext,
    step: Step,
    semantic: StageVerificationResult,
    deps: EngineDependencies
): void {
    const { task } = context;
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
}

export async function runPlanLoop(
    context: TaskExecutionContext,
    deps: EngineDependencies
): Promise<void> {
    const { task } = context;

    while (!isStopped(context) && !hasState(task, "WAITING_INPUT")) {
        const stepIndex = task.steps.findIndex((s) => !s.superseded && (s.state === "PENDING" || s.state === "RUNNING"));
        if (stepIndex === -1) {
            await concludeExhaustedPlan(context, deps);
            return;
        }

        task.currentStep = stepIndex;
        const step = task.steps[stepIndex];

        step.state = "RUNNING";
        emitStepRunning(deps, task.id, step, stepIndex);

        const run = await runStepGuarded(context, step, stepIndex, deps, "PLAN");
        if (run.kind === "cancelled") return;

        if (run.kind === "crashed") {
            if (!await handleReplan(context, stepIndex, deps)) {
                return;
            }
            continue;
        }
        const execResult = run.result;

        if (isStopped(context) || hasState(task, "WAITING_INPUT")) {
            return;
        }

        if (execResult.signals?.denied || hasState(step, "BLOCKED")) {
            console.warn(`[PLAN] Acción denegada por Guard o usuario. Prohibido replanificar para eludir denegación.`);
            await concludeAsFailure(context, deps, GUARD_DENIED_REASON);
            return;
        }

        if (execResult.status === "ok") {
            step.state = "COMPLETED";
            emitStepCompleted(deps, task.id, step, stepIndex);
            continue;
        }

        if (execResult.status === "unverified") {
            step.state = "UNVERIFIED";
            emitStepCompleted(deps, task.id, step, stepIndex);
            console.log(`[PLAN] Paso ${step.id} registrado como UNVERIFIED. Continuando hacia la siguiente etapa.`);
            continue;
        }

        // logical_error | blocked_loop. `semantic` es el veredicto de Qwen cuando Eos no aprobó el paso.
        step.error = execResult.error || "Fallo en ejecución del paso.";
        const semantic = execResult.semantic;

        if (semantic?.status === "insufficient_info") {
            if ((step.questionsAsked ?? 0) < MAX_USER_QUESTIONS_PER_STEP) {
                suspendForUserAnswer(context, step, semantic, deps);
                return;
            }
            // Tope de preguntas agotado: la falta de información se trata como desviación recuperable.
            step.error = `Información insuficiente tras ${step.questionsAsked} preguntas al usuario.`;
            recordFailure(context, "insufficient_info", { stepId: step.id, subject: step.tool ?? step.route, note: `${step.questionsAsked} preguntas` });
        } else if (semantic?.status === "unrecoverable_blocked") {
            step.state = "BLOCKED";
            // Sin prosa del modelo: el `reason` de Qwen viaja solo en el evento STAGE_VERIFIED y en la traza.
            step.error = UNRECOVERABLE_BLOCKED_REASON;
            emitStepError(deps, task.id, step, stepIndex);
            await concludeAsFailure(context, deps, UNRECOVERABLE_BLOCKED_REASON);
            return;
        }

        step.state = "FAILED";
        emitStepError(deps, task.id, step, stepIndex);

        if (!await handleReplan(context, stepIndex, deps)) {
            return;
        }
    }
}