import React from "react";
import { StatusDot } from "../../Shared/StatusDot.tsx";

interface SystemStatusProps {
  isExecuting: boolean;
  mcpCount: number;
}

export const SystemStatus: React.FC<SystemStatusProps> = ({ isExecuting, mcpCount }) => {
  return (
    <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 font-mono">
      <StatusDot status={isExecuting ? "running" : "completed"} />
      <span className="text-slate-300 font-medium">
        {isExecuting ? "Ejecutando Tarea" : "Core Listo"}
      </span>
      <span aria-hidden="true" className="text-slate-600">·</span>
      <span>Decision 2.0 (Kai-0.6B)</span>
      <span aria-hidden="true" className="text-slate-600">·</span>
      <span>{mcpCount} Servidores MCP</span>
      <span aria-hidden="true" className="text-slate-600">·</span>
      <span>Guard Activo</span>
    </div>
  );
};
