import React from "react";
import { AlertCircle, CheckCircle2, Loader2, Plus, XCircle } from "lucide-react";
import type { StepState, TaskDto, TaskState } from "../../../types/api.ts";
import { StatusDot } from "../../Shared/StatusDot.tsx";
import {
  getActivityPhrase,
  getTaskStatusType,
  MODE_LABELS,
  type ActivityStateGroup,
} from "../../../utils/taskStatus.ts";

const SEGMENT_TONE: Record<StepState, string> = {
  pending: "bg-slate-800",
  running: "bg-sky-400 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-rose-500",
};

const ACTIVITY_TONE: Record<ActivityStateGroup, string> = {
  working: "text-sky-200",
  waiting: "text-amber-200",
  finished: "text-slate-300",
};

const ActivityIcon: React.FC<{ group: ActivityStateGroup; state: TaskState }> = ({
  group,
  state,
}) => {
  if (group === "working")
    return <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />;
  if (group === "waiting")
    return <AlertCircle className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" />;
  if (state === "completed")
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  if (state === "partial")
    return <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  return (
    <XCircle
      className={`w-3.5 h-3.5 shrink-0 ${
        state === "failed" ? "text-rose-400" : "text-slate-400"
      }`}
    />
  );
};

interface TaskOverviewProps {
  task: TaskDto;
  onNewTask?: () => void;
}

function getProgressText(task: TaskDto): string {
  const activeSteps = task.steps.filter((s) => !s.superseded);
  const totalSteps = activeSteps.length;

  if (totalSteps === 0) return "Respuesta directa";

  const completedSteps = activeSteps.filter((s) => s.state === "completed").length;
  const runningStepIdx = activeSteps.findIndex((s) => s.state === "running");

  switch (task.task.state) {
    case "completed":
      return `${completedSteps} de ${totalSteps} ${
        totalSteps === 1 ? "paso completado" : "pasos completados"
      }`;
    case "failed":
      return `Falló en paso ${runningStepIdx >= 0 ? runningStepIdx + 1 : totalSteps} (${completedSteps} completados)`;
    case "cancelled":
      return `Cancelada (${completedSteps} de ${totalSteps} completados)`;
    case "partial":
      return `Parcial (${completedSteps} de ${totalSteps} completados)`;
  }

  if (task.task.mode === "deliberative") {
    const current = runningStepIdx >= 0 ? runningStepIdx + 1 : completedSteps + 1;
    return `Paso ${Math.min(current, totalSteps)} de ${totalSteps}`;
  }

  return `Paso ${completedSteps + 1} de ${totalSteps}`;
}

export const TaskOverview: React.FC<TaskOverviewProps> = ({ task, onNewTask }) => {
  const replans = Math.max(0, task.plans.length - 1);
  const activeSteps = task.steps.filter((s) => !s.superseded);
  const progress = getProgressText(task);
  const activity = getActivityPhrase(task);

  return (
    <header className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3 min-w-0">
        <StatusDot status={getTaskStatusType(task.task.state, Boolean(task.waiting))} />
        <h2
          title={task.task.request}
          className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-50"
        >
          {task.task.request}
        </h2>
        <span className="hidden md:inline shrink-0 text-xs text-slate-400 tabular-nums">
          {MODE_LABELS[task.task.mode]} · {progress}
          {replans > 0 && (
            <span className="text-amber-300">
              {" "}
              · {replans} {replans === 1 ? "replanificación" : "replanificaciones"}
            </span>
          )}
        </span>

        {task.task.state !== "running" && onNewTask && (
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
        {activeSteps.length > 0 && (
          <div role="img" aria-label={progress} className="flex gap-1 w-28 sm:w-44 shrink-0">
            {activeSteps.map((s, i) => (
              <span
                key={`${s.id}-${i}`}
                title={`${i + 1}. ${s.instruction || "Paso"}`}
                className={`h-1 flex-1 rounded-full ${SEGMENT_TONE[s.state] || "bg-slate-800"}`}
              />
            ))}
          </div>
        )}
        <p
          role="status"
          aria-live="polite"
          title={activity.label}
          className={`flex items-center gap-2 min-w-0 text-xs ${
            ACTIVITY_TONE[activity.stateGroup]
          }`}
        >
          <ActivityIcon group={activity.stateGroup} state={task.task.state} />
          <span className="truncate">{activity.label}</span>
        </p>
      </div>
    </header>
  );
};
