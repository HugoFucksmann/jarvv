import React from "react";
import { Plus } from "lucide-react";
import type { Task } from "../../../core/types.ts";
import { StatusDot } from "../../Shared/StatusDot.tsx";
import { Separator } from "../../Shared/Separator.tsx";
import { getTaskStatusType, getTaskStateLabel } from "../../../utils/taskStatus.ts";

interface TaskOverviewProps {
  task: Task;
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

export const TaskOverview: React.FC<TaskOverviewProps> = ({ task, onNewTask }) => {
  const replans = task.replans ?? 0;
  const escalations = task.escalations ?? 0;

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
      <div className="flex items-center gap-2.5">
        <StatusDot status={getTaskStatusType(task.state)} />
        <span className="text-sm font-semibold text-slate-100">{task.message}</span>
      </div>

      <div className="flex items-center gap-2.5 text-xs font-mono text-slate-400 shrink-0">
        <span className="text-slate-300 font-medium">
          {getTaskStateLabel(task.state, task.waitingReason)}
        </span>
        <Separator />
        <span>Modo {task.mode === "NORMAL" ? "NORMAL (FAST)" : task.mode}</span>
        <Separator />
        <span className="tabular-nums">{getProgressText(task)}</span>

        {replans > 0 && (
          <>
            <Separator />
            <span className="text-amber-400 font-semibold">Replans: {replans}</span>
          </>
        )}
        {escalations > 0 && (
          <>
            <Separator />
            <span className="text-orange-400 font-semibold">Escalaciones: {escalations}</span>
          </>
        )}

        {/* Nueva consulta: disponible cuando la tarea no está en ejecución */}
        {task.state !== "RUNNING" && onNewTask && (
          <button
            type="button"
            onClick={onNewTask}
            title="Iniciar nueva consulta (limpiar vista activa)"
            aria-label="Iniciar nueva consulta"
            className="ml-2 flex items-center gap-1 px-2 py-0.5 text-[11px] font-sans font-medium text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3 text-sky-400" />
            <span>Nueva consulta</span>
          </button>
        )}
      </div>
    </div>
  );
};