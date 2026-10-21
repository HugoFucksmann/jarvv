import type { Task } from "../core/types.ts";
import type { StatusDotStatus } from "../components/Shared/StatusDot.tsx";

/**
 * Fuente única de verdad para traducir el estado de una tarea
 * a su representación visual (color del StatusDot) y textual.
 *
 * Los tipos se derivan de `Task` para no depender de nombres exportados
 * y para que un estado nuevo sea detectado por el compilador.
 */
type TaskState = Task["state"];

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