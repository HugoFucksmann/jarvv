import type { TaskState, StepState, ExecutionMode, TaskDto } from "../types/api.ts";
import type { StatusDotStatus } from "../components/Shared/StatusDot.tsx";

export function getTaskStatusType(state?: TaskState, isWaiting: boolean = false): StatusDotStatus {
  if (isWaiting) return "approval";
  switch (state) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "partial":
      return "unverified";
    case "failed":
      return "failed";
    case "cancelled":
    default:
      return "idle";
  }
}

export function getWaitingReasonLabel(kind?: string | null): string {
  switch (kind) {
    case "approval":
      return "Esperando aprobación";
    case "plan":
      return "Esperando confirmación de plan";
    case "question":
      return "Esperando respuesta";
    default:
      return "Esperando interacción";
  }
}

export function getTaskStateLabel(state: TaskState, waitingKind?: string | null): string {
  if (waitingKind) {
    return getWaitingReasonLabel(waitingKind);
  }
  switch (state) {
    case "running":
      return "En ejecución";
    case "completed":
      return "Completada";
    case "partial":
      return "Parcialmente completada";
    case "failed":
      return "Fallida";
    case "cancelled":
      return "Cancelada";
    default:
      return state;
  }
}

export const MODE_LABELS: Record<ExecutionMode, string> = {
  reactive: "REACTIVO",
  deliberative: "DELIBERATIVO",
};

export const STEP_STATE_LABELS: Record<StepState, string> = {
  pending: "Pendiente",
  running: "En curso",
  completed: "Completado",
  failed: "Fallido",
};

export type ActivityStateGroup = "working" | "waiting" | "finished";

export interface ActivityPhrase {
  stateGroup: ActivityStateGroup;
  label: string;
}

export function getActivityPhrase(task: TaskDto | null | undefined): ActivityPhrase {
  if (!task) {
    return { stateGroup: "finished", label: "Sin tarea activa" };
  }

  // 1. Esperando interacción del usuario
  if (task.waiting) {
    switch (task.waiting.kind) {
      case "approval":
        return {
          stateGroup: "waiting",
          label: "Esperando autorización en Guard para continuar",
        };
      case "plan":
        return {
          stateGroup: "waiting",
          label: "Esperando revisión y confirmación del plan",
        };
      case "question":
        return {
          stateGroup: "waiting",
          label: "Esperando respuesta a pregunta interactiva",
        };
      default:
        return { stateGroup: "waiting", label: "Esperando interacción del usuario" };
    }
  }

  // 2. Tarea terminada
  if (task.task.state !== "running") {
    switch (task.task.state) {
      case "completed":
        return { stateGroup: "finished", label: "Tarea completada con éxito" };
      case "failed":
        return {
          stateGroup: "finished",
          label: task.task.stopReason
            ? `Tarea finalizada con error (${task.task.stopReason})`
            : "Tarea finalizada con error",
        };
      case "cancelled":
        return { stateGroup: "finished", label: "Tarea cancelada" };
      case "partial":
        return {
          stateGroup: "finished",
          label: task.task.stopReason
            ? `Tarea concluida parcialmente (${task.task.stopReason})`
            : "Tarea concluida parcialmente",
        };
      default:
        return { stateGroup: "finished", label: `Tarea finalizada (${task.task.state})` };
    }
  }

  // 3. Tarea en ejecución
  const lastCall = task.calls[task.calls.length - 1];
  if (lastCall && (!lastCall.status || lastCall.status === "running")) {
    return {
      stateGroup: "working",
      label: `Ejecutando herramienta ${lastCall.tool}…`,
    };
  }

  const runningStep = task.steps.find((s) => s.state === "running" && !s.superseded);
  if (runningStep) {
    const stepIdx = task.steps.indexOf(runningStep) + 1;
    return {
      stateGroup: "working",
      label: runningStep.instruction
        ? `Ejecutando paso #${stepIdx}: ${runningStep.instruction}`
        : `Ejecutando paso #${stepIdx}…`,
    };
  }

  if (task.task.mode === "deliberative" && task.steps.length === 0) {
    return {
      stateGroup: "working",
      label: "Estructurando plan de ejecución…",
    };
  }

  return { stateGroup: "working", label: "Ejecutando tarea…" };
}
