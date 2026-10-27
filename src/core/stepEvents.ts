/**
 * JARVIS Core — Eventos de ciclo de vida de un paso (STEP_STATE_CHANGED, STEP_COMPLETED).
 * Único lugar que construye su payload: los emiten tanto el ejecutor de pasos (aprobación, bloqueo) como los motores
 * de modo (inicio, cierre). `stepIndex` solo lo conocen los motores de modo; quien no lo tiene lo omite y el evento
 * no lleva esa clave.
 */

import type { Step, StepState } from "./types.ts";
import type { EngineDependencies } from "./engineDeps.ts";

type StepEventEmitter = Pick<EngineDependencies, "emitEvent">;

const withIndex = (stepIndex: number | undefined): { stepIndex?: number } =>
    stepIndex === undefined ? {} : { stepIndex };

/** El paso cambió de estado sin terminar (RUNNING, WAITING_APPROVAL). */
export function emitStepStateChanged(
    deps: StepEventEmitter,
    taskId: string,
    step: Step,
    state: StepState,
    stepIndex?: number
): void {
    deps.emitEvent(taskId, "STEP_STATE_CHANGED", { step, ...withIndex(stepIndex), state }, step.id);
}

/** El paso empezó a ejecutarse. */
export function emitStepRunning(deps: StepEventEmitter, taskId: string, step: Step, stepIndex: number): void {
    emitStepStateChanged(deps, taskId, step, "RUNNING", stepIndex);
}

/** El paso terminó sin error (COMPLETED o UNVERIFIED). */
export function emitStepCompleted(deps: StepEventEmitter, taskId: string, step: Step, stepIndex?: number): void {
    deps.emitEvent(taskId, "STEP_COMPLETED", { step, ...withIndex(stepIndex) }, step.id);
}

/** El paso terminó con `step.error` (FAILED o BLOCKED). */
export function emitStepError(deps: StepEventEmitter, taskId: string, step: Step, stepIndex?: number): void {
    deps.emitEvent(taskId, "STEP_COMPLETED", { step, ...withIndex(stepIndex), error: step.error }, step.id);
}