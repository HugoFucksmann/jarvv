import type { Task, Step, CoreEvent } from "../../src/core/types.ts";
import type { StatusDotStatus } from "../components/Shared/StatusDot.tsx";

/**
 * Fuente única de verdad para traducir el estado de una tarea
 * a su representación visual (color del StatusDot) y textual.
 *
 * Los tipos se derivan de `Task` para no depender de nombres exportados
 * y para que un estado nuevo sea detectado por el compilador.
 */
type TaskState = Task["state"];
type StepState = Step["state"];

export function getTaskStatusType(state: TaskState): StatusDotStatus {
    switch (state) {
        case "RUNNING":
            return "running";
        case "WAITING_INPUT":
            return "approval";
        case "COMPLETED":
            return "completed";
        case "PARTIAL":
            return "unverified";
        case "FAILED":
            return "failed";
        case "CANCELLED":
        default:
            return "idle";
    }
}

/** Texto del motivo de espera. Acepta string para poder usarse con props sueltas. */
export function getWaitingReasonLabel(reason?: string | null): string {
    switch (reason) {
        case "approval":
            return "Esperando aprobación";
        case "plan_confirmation":
            return "Esperando confirmación de plan";
        case "user_answer":
            return "Esperando respuesta";
        default:
            return "Esperando interacción";
    }
}

export function getTaskStateLabel(state: TaskState, waitingReason?: string | null): string {
    switch (state) {
        case "RUNNING":
            return "En ejecución";
        case "WAITING_INPUT":
            return getWaitingReasonLabel(waitingReason);
        case "COMPLETED":
            return "Completada";
        case "PARTIAL":
            return "Parcialmente completada";
        case "FAILED":
            return "Fallida";
        case "CANCELLED":
            return "Cancelada";
        default:
            return state;
    }
}

/** Etiqueta de cada modo de ejecución. Exhaustivo sobre `TaskMode` del core: un modo nuevo rompe la compilación. */
export const MODE_LABELS: Record<Task["mode"], string> = {
    NORMAL: "NORMAL (FAST)",
    PLAN: "PLAN",
};

/** Estado de un paso en español. Exhaustivo sobre `StepState` del core: un estado nuevo rompe la compilación. */
export const STEP_STATE_LABELS: Record<StepState, string> = {
    PENDING: "Pendiente",
    RUNNING: "En curso",
    WAITING_APPROVAL: "Esperando aprobación",
    COMPLETED: "Completado",
    FAILED: "Fallido",
    UNVERIFIED: "Sin verificar",
    BLOCKED: "Bloqueado",
};

type StepLike = Pick<Step, "state" | "tool" | "mcp">;

/** El paso todavía no terminó: la herramienta se ejecuta, se espera una aprobación o no empezó. */
const isActiveStep = (step: StepLike): boolean =>
    step.state === "RUNNING" || step.state === "WAITING_APPROVAL" || step.state === "PENDING";

/** Frase para un paso que ya terminó mientras la tarea sigue en marcha (el core decide el siguiente movimiento). */
function settledStepPhrase(step: StepLike): string {
    if (step.state === "COMPLETED") return "Paso completado: decidiendo el siguiente…";
    const name = step.tool ? ` de ${step.tool}` : "";
    return `Resultado${name} sin éxito: decidiendo si reintentar o replanificar…`;
}

export type ActivityStateGroup = "working" | "waiting" | "finished";

export interface ActivityPhrase {
    stateGroup: ActivityStateGroup;
    label: string;
}

/**
 * Deriva la frase de actividad para el indicador de 3 estados (trabajando, esperando al usuario, terminada).
 * Usa roles ("clasificador", "razonador", "herramienta"), nunca nombres de modelos.
 */
export function getActivityPhrase(
    task: Task | null | undefined,
    lastEvent?: CoreEvent | null
): ActivityPhrase {
    if (!task) {
        return { stateGroup: "finished", label: "Sin tarea activa" };
    }

    // 1. Esperando al usuario
    if (task.state === "WAITING_INPUT") {
        if (task.waitingReason === "approval") {
            return { stateGroup: "waiting", label: "Esperando autorización en Guard para continuar" };
        }
        if (task.waitingReason === "user_answer") {
            return { stateGroup: "waiting", label: "Esperando respuesta a pregunta interactiva" };
        }
        if (task.waitingReason === "plan_confirmation") {
            return { stateGroup: "waiting", label: "Esperando revisión y confirmación del plan" };
        }
        return { stateGroup: "waiting", label: "Esperando interacción del usuario" };
    }

    // 2. Terminada
    if (task.state !== "RUNNING") {
        switch (task.state) {
            case "COMPLETED":
                return { stateGroup: "finished", label: "Tarea completada con éxito" };
            case "FAILED":
                return { stateGroup: "finished", label: "Tarea finalizada con error" };
            case "CANCELLED":
                return { stateGroup: "finished", label: "Tarea cancelada" };
            case "PARTIAL":
                return { stateGroup: "finished", label: "Tarea concluida parcialmente" };
            default:
                return { stateGroup: "finished", label: `Tarea finalizada (${task.state})` };
        }
    }

    // 3. Trabajando: derivar frase del último evento o del paso en curso.
    // `lastEvent` es una unión discriminada: cada `case` estrecha `lastEvent.data` al tipo de ese evento.
    if (lastEvent) {
        switch (lastEvent.type) {
            case "DECISION_ONE":
                return { stateGroup: "working", label: "Clasificador evaluando ruta de ejecución…" };
            case "DECISION_TWO": {
                const { tool } = lastEvent.data;
                return {
                    stateGroup: "working",
                    label: tool ? `Clasificador seleccionando herramienta (${tool})…` : "Clasificador seleccionando herramienta…",
                };
            }
            case "ARGUMENTS_GENERATED":
                return { stateGroup: "working", label: "Razonador preparando argumentos de llamada…" };
            case "GUARD_EVALUATION":
                return { stateGroup: "working", label: "Evaluando políticas de seguridad en Guard…" };
            case "MCP_DISPATCHED": {
                const { mcp, tool } = lastEvent.data;
                const toolName = tool ? `${mcp ? `${mcp}:` : ""}${tool}` : "herramienta";
                return { stateGroup: "working", label: `Ejecutando herramienta ${toolName}…` };
            }
            case "MCP_RESULT":
                return { stateGroup: "working", label: "Procesando resultado de herramienta…" };
            case "RESULT_PROCESSED":
                return { stateGroup: "working", label: "Verificando resultado con clasificador…" };
            // Tras un paso ya no hay herramienta en ejecución: la frase describe lo que sigue, no el paso que terminó.
            case "STEP_STATE_CHANGED":
            case "STEP_COMPLETED": {
                const { step } = lastEvent.data;
                if (step.state === "RUNNING" || step.state === "WAITING_APPROVAL") break;
                return { stateGroup: "working", label: settledStepPhrase(step) };
            }
            case "PLAN_REJECTED":
                return { stateGroup: "working", label: "Plan rechazado: razonador replanificando…" };
            case "APPROVAL_RESOLVED":
                return {
                    stateGroup: "working",
                    label: lastEvent.data.approved
                        ? "Autorización concedida: reanudando ejecución…"
                        : "Autorización denegada: reevaluando cómo continuar…",
                };
            case "STAGE_VERIFIED":
                return { stateGroup: "working", label: "Razonador verificando cumplimiento de etapa…" };
            case "PLAN_GENERATED":
            case "PLAN_MODIFIED":
                return { stateGroup: "working", label: "Razonador estructurando plan de ejecución…" };
            case "FINAL_RESPONSE":
                return { stateGroup: "working", label: "Razonador sintetizando respuesta final…" };
        }
    }

    // Sin evento reciente o con uno que no aporta frase: se usa el estado de la tarea.
    if (task.mode === "PLAN" && task.planConfirmed === false) {
        return { stateGroup: "working", label: "Razonador elaborando plan de etapas…" };
    }

    const currentStep = task.steps?.[task.currentStep];
    if (currentStep && !isActiveStep(currentStep)) {
        // Con el paso ya resuelto (p. ej. falló) la herramienta no se está ejecutando: se espera la siguiente decisión.
        return { stateGroup: "working", label: settledStepPhrase(currentStep) };
    }
    if (currentStep?.tool) {
        return { stateGroup: "working", label: `Ejecutando herramienta ${currentStep.mcp ? `${currentStep.mcp}:` : ""}${currentStep.tool}…` };
    }

    const seq = (task.currentStep ?? 0) + 1;
    return { stateGroup: "working", label: `Trabajando en paso #${seq}…` };
}