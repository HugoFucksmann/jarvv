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
        <span>Modo {task.mode}</span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span className="tabular-nums">
          Paso {task.currentStep + 1} de {Math.max(task.steps.length, 1)}
        </span>
      </div>
    </div>
  );
};
