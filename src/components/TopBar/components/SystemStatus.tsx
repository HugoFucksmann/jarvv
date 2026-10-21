import React from "react";
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { StatusDot, type StatusDotStatus } from "../../Shared/StatusDot.tsx";
import { Separator } from "../../Shared/Separator.tsx";
import { getWaitingReasonLabel } from "../../../utils/taskStatus.ts";
import type { McpInitStatus } from "../../../types/ui.ts";

export interface SystemStatusProps {
  isExecuting: boolean;
  isWaitingInput?: boolean;
  waitingReason?: string | null;
  mcpCount: number;
  unavailableCount?: number;
  mcpInitStatus?: McpInitStatus;
}

interface McpStatusProps {
  status: McpInitStatus;
  count: number;
  unavailableCount: number;
}

const McpStatus: React.FC<McpStatusProps> = ({ status, count, unavailableCount }) => {
  const plural = count !== 1 ? "s" : "";

  switch (status) {
    case "loading":
      return (
        <span className="flex items-center gap-1.5 text-sky-400 animate-pulse font-medium">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span>Inicializando MCP…</span>
        </span>
      );
    case "ready":
      return (
        <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          <span>
            {count} MCP{plural} Listos
          </span>
        </span>
      );
    case "partial":
      return (
        <span className="flex items-center gap-1.5 text-amber-400 font-medium">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>
            {count} MCP{plural} · {unavailableCount} no disponible{unavailableCount > 1 ? "s" : ""}
          </span>
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1.5 text-rose-400 font-medium">
          <XCircle className="w-3 h-3 shrink-0" />
          <span>MCPs no disponibles</span>
        </span>
      );
  }
};

export const SystemStatus: React.FC<SystemStatusProps> = ({
  isExecuting,
  isWaitingInput = false,
  waitingReason = null,
  mcpCount,
  unavailableCount = 0,
  mcpInitStatus = "ready",
}) => {
  let statusType: StatusDotStatus;
  let statusLabel: string;
  let statusColorClass: string;

  if (isExecuting) {
    statusType = "running";
    statusLabel = "Ejecutando Tarea";
    statusColorClass = "text-sky-300 font-medium";
  } else if (isWaitingInput) {
    statusType = "approval";
    statusLabel = getWaitingReasonLabel(waitingReason);
    statusColorClass = "text-amber-300 font-medium animate-pulse";
  } else {
    statusType = unavailableCount > 0 ? "unverified" : "completed";
    statusLabel = "Core Listo";
    statusColorClass = "text-slate-300 font-medium";
  }

  return (
    <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 font-mono">
      <StatusDot status={statusType} />
      <span className={statusColorClass}>{statusLabel}</span>
      <Separator />
      <span title="Motor de decisión configurado por defecto">Decision 2.0 (Eos-0.8B)</span>
      <Separator />
      <McpStatus status={mcpInitStatus} count={mcpCount} unavailableCount={unavailableCount} />
      <Separator />
      <span title="Políticas de seguridad y compuertas de autorización habilitadas">
        Políticas Guard
      </span>
    </div>
  );
};