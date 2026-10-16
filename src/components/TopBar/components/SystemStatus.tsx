import React from "react";
import { StatusDot } from "../../Shared/StatusDot.tsx";
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

interface SystemStatusProps {
  isExecuting: boolean;
  isWaitingInput?: boolean;
  waitingReason?: string | null;
  mcpCount: number;
  unavailableCount?: number;
  mcpInitStatus?: "loading" | "ready" | "partial" | "error";
}

export const SystemStatus: React.FC<SystemStatusProps> = ({
  isExecuting,
  isWaitingInput = false,
  waitingReason = null,
  mcpCount,
  unavailableCount = 0,
  mcpInitStatus = "ready",
}) => {
  const isMcpLoading = mcpInitStatus === "loading";

  // Determinar estado y texto visual diferenciando RUNNING, WAITING_INPUT y Listo
  const statusType = isExecuting
    ? "running"
    : isWaitingInput
    ? "approval"
    : unavailableCount > 0
    ? "unverified"
    : "completed";

  const statusLabel = isExecuting
    ? "Ejecutando Tarea"
    : isWaitingInput
    ? waitingReason === "approval"
      ? "Esperando Aprobación"
      : waitingReason === "plan_confirmation"
      ? "Esperando Confirmación de Plan"
      : waitingReason === "user_answer"
      ? "Esperando Respuesta"
      : "Esperando Entrada"
    : "Core Listo";

  const statusColorClass = isExecuting
    ? "text-sky-300 font-medium"
    : isWaitingInput
    ? "text-amber-300 font-medium animate-pulse"
    : "text-slate-300 font-medium";

  return (
    <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 font-mono">
      <StatusDot status={statusType} />
      <span className={statusColorClass}>
        {statusLabel}
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
