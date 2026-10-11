import React from "react";
import { StatusDot } from "../../Shared/StatusDot.tsx";

interface SystemStatusProps {
  isExecuting: boolean;
  mcpCount: number;
  unavailableCount?: number;
}

export const SystemStatus: React.FC<SystemStatusProps> = ({
  isExecuting,
  mcpCount,
  unavailableCount = 0,
}) => {
  return (
    <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 font-mono">
      <StatusDot status={isExecuting ? "running" : unavailableCount > 0 ? "unverified" : "completed"} />
      <span className="text-slate-300 font-medium">
        {isExecuting ? "Ejecutando Tarea" : "Core Listo"}
      </span>
      <span aria-hidden="true" className="text-slate-600">·</span>
      <span>Decision 2.0 (Eos-0.8B)</span>
      <span aria-hidden="true" className="text-slate-600">·</span>
      <span>{mcpCount} Servidores MCP</span>
      {unavailableCount > 0 && (
        <>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className="text-amber-400 font-medium">
            {unavailableCount} No disponible{unavailableCount > 1 ? "s" : ""}
          </span>
        </>
      )}
      <span aria-hidden="true" className="text-slate-600">·</span>
      <span>Guard Activo</span>
    </div>
  );
};
