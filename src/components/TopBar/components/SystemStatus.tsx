import React from "react";
import { StatusDot } from "../../Shared/StatusDot.tsx";
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

interface SystemStatusProps {
  isExecuting: boolean;
  mcpCount: number;
  unavailableCount?: number;
  mcpInitStatus?: "loading" | "ready" | "partial" | "error";
}

export const SystemStatus: React.FC<SystemStatusProps> = ({
  isExecuting,
  mcpCount,
  unavailableCount = 0,
  mcpInitStatus = "ready",
}) => {
  const isMcpLoading = mcpInitStatus === "loading";

  return (
    <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 font-mono">
      <StatusDot status={isExecuting ? "running" : unavailableCount > 0 ? "unverified" : "completed"} />
      <span className="text-slate-300 font-medium">
        {isExecuting ? "Ejecutando Tarea" : "Core Listo"}
      </span>
      <span aria-hidden="true" className="text-slate-600">·</span>
      <span>Decision 2.0 (Eos-0.8B)</span>
      <span aria-hidden="true" className="text-slate-600">·</span>

      {/* MCP initialization status */}
      {isMcpLoading ? (
        <span className="flex items-center gap-1.5 text-sky-400 animate-pulse font-medium">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span>Inicializando MCP…</span>
        </span>
      ) : mcpInitStatus === "ready" ? (
        <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          <span>{mcpCount} MCP{mcpCount !== 1 ? "s" : ""} Listos</span>
        </span>
      ) : mcpInitStatus === "partial" ? (
        <span className="flex items-center gap-1.5 text-amber-400 font-medium">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{mcpCount} MCP{mcpCount !== 1 ? "s" : ""} · {unavailableCount} no disponible{unavailableCount > 1 ? "s" : ""}</span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-rose-400 font-medium">
          <XCircle className="w-3 h-3 shrink-0" />
          <span>MCPs no disponibles</span>
        </span>
      )}

      <span aria-hidden="true" className="text-slate-600">·</span>
      <span>Guard Activo</span>
    </div>
  );
};
