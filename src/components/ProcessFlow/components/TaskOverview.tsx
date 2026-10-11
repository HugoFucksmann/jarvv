import React from "react";
import type { Task } from "../../../core/types.ts";
import { StatusDot } from "../../Shared/StatusDot.tsx";
import { Plus } from "lucide-react";

interface TaskOverviewProps {
  task: Task;
  onNewTask?: () => void;
}

export const TaskOverview: React.FC<TaskOverviewProps> = ({ task, onNewTask }) => {
  const getStatusText = () => {
    switch (task.state) {
      case "RUNNING":
        return "En ejecución";
      case "COMPLETED":
        return "Completada";
      case "PARTIAL":
        return "Parcialmente Completada";
      case "FAILED":
        return "Fallida";
      case "CANCELLED":
        return "Cancelada";
      default:
        return task.state;
    }
  };

  const getStatusType = () => {
    switch (task.state) {
      case "RUNNING":
        return "running";
      case "COMPLETED":
        return "completed";
      case "PARTIAL":
        return "unverified";
      case "FAILED":
        return "failed";
      case "CANCELLED":
        return "idle";
      default:
        return "idle";
    }
  };

  const activeSteps = task.steps.filter((s) => !s.superseded);
  const activeStepProgress = task.steps.slice(0, task.currentStep + 1).filter((s) => !s.superseded).length;

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
      <div className="flex items-center gap-2.5">
        <StatusDot status={getStatusType()} />
        <span className="text-sm font-semibold text-slate-100">
          {task.message}
        </span>
      </div>

      <div className="flex items-center gap-2.5 text-xs font-mono text-slate-400 shrink-0">
        <span className="text-slate-300 font-medium">{getStatusText()}</span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span>Modo {task.mode === "NORMAL" ? "NORMAL (FAST)" : task.mode}</span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span className="tabular-nums">
          {task.steps.length === 0
            ? "Respuesta directa"
            : task.mode === "PLAN"
            ? `Paso ${Math.min(activeStepProgress || 1, activeSteps.length)} de ${activeSteps.length}`
            : `Paso ${task.currentStep + 1}`}
        </span>
        {task.replans && task.replans > 0 ? (
          <>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-amber-400 font-semibold">Replans: {task.replans}</span>
          </>
        ) : null}
        {task.escalations && task.escalations > 0 ? (
          <>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-orange-400 font-semibold">Escalaciones: {task.escalations}</span>
          </>
        ) : null}

        {/* Acción para iniciar nueva consulta cuando la tarea no esté en ejecución */}
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
