import React from "react";
import { Task } from "../../../core/types.ts";
import { StatusDot } from "../../Shared/StatusDot.tsx";

interface TaskOverviewProps {
  task: Task;
}

export const TaskOverview: React.FC<TaskOverviewProps> = ({ task }) => {
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

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-3 border-b border-slate-800">
      <div className="flex items-center gap-2.5">
        <StatusDot status={getStatusType()} />
        <span className="text-sm font-semibold text-slate-100">
          {task.message}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
        <span className="text-slate-300 font-medium">{getStatusText()}</span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span>Modo {task.mode === "NORMAL" ? "FAST" : task.mode}</span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span className="tabular-nums">
          {task.steps.length === 0
            ? "Respuesta directa"
            : task.mode === "PLAN"
            ? `Paso ${Math.min(task.currentStep + 1, task.steps.length)} de ${task.steps.length}`
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
      </div>
    </div>
  );
};
