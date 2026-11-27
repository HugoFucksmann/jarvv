import type { TaskState, StepState, ExecutionMode, TaskDto, FactEntry } from "../types/api.ts";
import type { StatusDotStatus } from "../components/Shared/StatusDot.tsx";

export function getTaskStatusType(
  state?: TaskState,
  isWaiting: boolean = false,
  isPaused: boolean = false
): StatusDotStatus {
  if (isWaiting || (state === "running" && isPaused)) return "approval";
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

export function formatPausedModelLabel(model: string): string {
  switch (model) {
    case "llm":
      return "LLM";
    case "decision":
      return "Modelo de decisión";
    default:
      return model;
  }
}

const VERDICT_REASON_LABELS: Record<string, string> = {
  not_accomplished: "No cumple lo esperado",
  no_usable_data: "Sin datos útiles",
  wrong_place: "Ubicación incorrecta",
  wrong_position: "Posición incorrecta",
  wrong_scope: "Alcance incorrecto",
  wrong_item: "Elemento incorrecto",
  missing_attribute: "Falta un atributo requerido",
};

export function formatVerdictReason(reason: string): string {
  return VERDICT_REASON_LABELS[reason]
    ? `${VERDICT_REASON_LABELS[reason]} (${reason})`
    : reason;
}

export function parseProcessPids(fact?: FactEntry | null): string[] {
  if (!fact || fact.value === null || fact.value === undefined) return [];
  const raw = String(fact.value).trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
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

interface ActivityPhrase {
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

  // 2. Pausada por modelo no disponible
  if (task.task.state === "running" && task.paused) {
    const modelLabel = formatPausedModelLabel(task.paused.model);
    return {
      stateGroup: "waiting",
      label: `Pausada: ${modelLabel} no disponible (reintentando automáticamente)`,
    };
  }

  // 3. Tarea terminada (task.state pasa a terminal antes de escribirse result)
  if (task.task.state !== "running") {
    if (!task.result) {
      return {
        stateGroup: "working",
        label: "Redactando respuesta final…",
      };
    }
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

  // 4. Tarea en ejecución
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

  if (task.steps.length === 0) {
    return {
      stateGroup: "working",
      label:
        task.task.mode === "deliberative"
          ? "Estructurando plan de ejecución…"
          : "Evaluando consulta…",
    };
  }

  return { stateGroup: "working", label: "Ejecutando tarea…" };
}
