import React from "react";
import { AlertCircle, CheckCircle2, Loader2, Plus, XCircle } from "lucide-react";
import type { CoreEvent, Step, Task } from "../../../../src/core/types.ts";
import { StatusDot } from "../../Shared/StatusDot.tsx";
import { getActivityPhrase, getTaskStatusType, MODE_LABELS, type ActivityStateGroup } from "../../../utils/taskStatus.ts";

/** Color de cada tramo de la barra de progreso. Exhaustivo sobre `StepState`: un estado nuevo rompe la compilación. */
const SEGMENT_TONE: Record<Step["state"], string> = {
  PENDING: "bg-slate-800",
  RUNNING: "bg-sky-400 animate-pulse",
  WAITING_APPROVAL: "bg-amber-400 animate-pulse",
  COMPLETED: "bg-emerald-500",
  FAILED: "bg-rose-500",
  UNVERIFIED: "bg-amber-500/70",
  BLOCKED: "bg-rose-500/60",
};

/** Color del texto de la actividad según su grupo. */
const ACTIVITY_TONE: Record<ActivityStateGroup, string> = {
  working: "text-sky-200",
  waiting: "text-amber-200",
  finished: "text-slate-300",
};

const ActivityIcon: React.FC<{ group: ActivityStateGroup; state: Task["state"] }> = ({ group, state }) => {
  if (group === "working") return <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />;
  if (group === "waiting") return <AlertCircle className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" />;
  if (state === "COMPLETED") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  // Cancelada, parcial o fallida: nunca se muestra el visto de éxito.
  if (state === "PARTIAL") return <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  return <XCircle className={`w-3.5 h-3.5 shrink-0 ${state === "FAILED" ? "text-rose-400" : "text-slate-400"}`} />;
};

interface TaskOverviewProps {
  task: Task;
  events: CoreEvent[];
  onNewTask?: () => void;
}

function getProgressText(task: Task): string {
  const activeSteps = task.steps.filter((s) => !s.superseded);
  const totalSteps = activeSteps.length;

  if (totalSteps === 0) return "Respuesta directa";

  const completedSteps = activeSteps.filter((s) => s.state === "COMPLETED").length;
  const activeStepProgress = task.steps
    .slice(0, task.currentStep + 1)
    .filter((s) => !s.superseded).length;

  switch (task.state) {
    case "COMPLETED":
      return `${completedSteps} de ${totalSteps} ${totalSteps === 1 ? "paso completado" : "pasos completados"}`;
    case "FAILED":
      return `Falló en paso ${Math.max(1, activeStepProgress)} (${completedSteps} completados)`;
    case "CANCELLED":
      return `Cancelada (${completedSteps} de ${totalSteps} completados)`;
    case "PARTIAL":
      return `Parcial (${completedSteps} de ${totalSteps} completados)`;
  }

  if (task.mode === "PLAN") {
    const current = Math.min(Math.max(1, activeStepProgress), totalSteps);
    return `Paso ${current} de ${totalSteps}`;
  }

  const currentSeq = Math.max(1, task.currentStep + 1);
  return totalSteps > currentSeq ? `Paso ${currentSeq} de ${totalSteps}` : `Paso ${currentSeq}`;
}

/** Cabezal compacto de la tarea: instrucción, avance por pasos y qué está haciendo ahora, en dos líneas. */
export const TaskOverview: React.FC<TaskOverviewProps> = ({ task, events, onNewTask }) => {
  const replans = task.replans ?? 0;
  const activeSteps = task.steps.filter((s) => !s.superseded);
  const progress = getProgressText(task);
  const activity = getActivityPhrase(task, events[events.length - 1]);

  return (
    <header className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3 min-w-0">
        <StatusDot status={getTaskStatusType(task.state)} />
        <h2 title={task.message} className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-50">
          {task.message}
        </h2>
        <span className="hidden md:inline shrink-0 text-xs text-slate-400 tabular-nums">
          {MODE_LABELS[task.mode]} · {progress}
          {replans > 0 && (
            <span className="text-amber-300">
              {" "}· {replans} {replans === 1 ? "replanificación" : "replanificaciones"}
            </span>
          )}
        </span>

        {/* Nueva consulta: disponible cuando la tarea no está en ejecución */}
        {task.state !== "RUNNING" && onNewTask && (
          <button
            type="button"
            onClick={onNewTask}
            title="Iniciar nueva consulta (limpiar vista activa)"
            aria-label="Iniciar nueva consulta"
            className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Nueva</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 min-w-0">
        {/* Un tramo por paso vigente: el estado de toda la tarea de un vistazo */}
        {activeSteps.length > 0 && (
          <div role="img" aria-label={progress} className="flex gap-1 w-28 sm:w-44 shrink-0">
            {activeSteps.map((s, i) => (
              <span
                key={`${s.id}-${i}`}
                title={`${i + 1}. ${s.instruction}`}
                className={`h-1 flex-1 rounded-full ${SEGMENT_TONE[s.state]}`}
              />
            ))}
          </div>
        )}
        <p
          role="status"
          aria-live="polite"
          title={activity.label}
          className={`flex items-center gap-2 min-w-0 text-xs ${ACTIVITY_TONE[activity.stateGroup]}`}
        >
          <ActivityIcon group={activity.stateGroup} state={task.state} />
          <span className="truncate">{activity.label}</span>
        </p>
      </div>
    </header>
  );
};