import React, { useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Laptop, ShieldCheck, Shield } from "lucide-react";
import { StatusDot, type StatusDotStatus } from "../../Shared/StatusDot.tsx";
import { Separator } from "../../Shared/Separator.tsx";
import { getWaitingReasonLabel } from "../../../utils/taskStatus.ts";
import type { McpInitStatus } from "../../../types/ui.ts";
import type { UnavailableServers } from "../../../types/api.ts";
import { UnavailableServersPopover } from "./UnavailableServersPopover.tsx";

export interface SystemStatusProps {
  isExecuting: boolean;
  isWaitingInput?: boolean;
  waitingReason?: string | null;
  mcpCount: number;
  unavailableCount?: number;
  mcpInitStatus?: McpInitStatus;
  unavailableServers?: UnavailableServers;
  autoMode?: boolean;
  onOpenEnvironment?: () => void;
}

interface McpStatusProps {
  status: McpInitStatus;
  count: number;
  unavailableCount: number;
  onToggleDetails?: () => void;
}

const McpStatus: React.FC<McpStatusProps> = ({ status, count, unavailableCount, onToggleDetails }) => {
  const plural = count !== 1 ? "s" : "";

  switch (status) {
    case "loading":
      return (
        <span className="flex items-center gap-1.5 text-accent-400 animate-pulse font-medium">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span>Inicializando MCP…</span>
        </span>
      );
    case "ready":
      return (
        <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          <span>
            {count} MCP{plural} listos
          </span>
        </span>
      );
    case "partial":
      return (
        <button
          type="button"
          onClick={onToggleDetails}
          title="Ver detalle de servidores MCP no disponibles"
          className="flex items-center gap-1.5 text-yellow-300 font-medium hover:text-yellow-200 transition-colors cursor-pointer bg-yellow-950/30 px-1.5 py-0.5 rounded border border-yellow-800/50"
        >
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>
            {count} MCP{plural} · {unavailableCount} caído{unavailableCount > 1 ? "s" : ""}
          </span>
        </button>
      );
    default:
      return (
        <button
          type="button"
          onClick={onToggleDetails}
          title="Ver detalle de servidores MCP no disponibles"
          className="flex items-center gap-1.5 text-rose-300 font-medium hover:text-rose-200 transition-colors cursor-pointer bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-800/60"
        >
          <XCircle className="w-3 h-3 shrink-0" />
          <span>MCPs no disponibles</span>
        </button>
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
  unavailableServers = {},
  autoMode = false,
  onOpenEnvironment,
}) => {
  const [showUnavailablePopover, setShowUnavailablePopover] = useState(false);

  let statusType: StatusDotStatus;
  let statusLabel: string;
  let statusColorClass: string;

  if (isExecuting) {
    statusType = "running";
    statusLabel = "Ejecutando tarea";
    statusColorClass = "text-accent-300 font-medium";
  } else if (isWaitingInput) {
    statusType = "approval";
    statusLabel = getWaitingReasonLabel(waitingReason);
    statusColorClass = "text-yellow-300 font-medium animate-pulse";
  } else {
    statusType = unavailableCount > 0 ? "unverified" : "completed";
    statusLabel = "Core listo";
    statusColorClass = "text-slate-300 font-medium";
  }

  return (
    <div className="relative hidden md:flex items-center gap-2.5 text-xs text-slate-400">
      <StatusDot status={statusType} />
      <span className={statusColorClass}>{statusLabel}</span>

      <Separator />

      {onOpenEnvironment && (
        <button
          type="button"
          onClick={onOpenEnvironment}
          title="Ver datos de la PC (carpetas resueltas) y límites del motor"
          className="flex items-center gap-1.5 text-slate-300 hover:text-accent-300 transition-colors cursor-pointer"
        >
          <Laptop className="w-3 h-3 text-accent-400" />
          <span>Entorno PC</span>
        </button>
      )}

      <Separator />

      <div className="relative">
        <McpStatus
          status={mcpInitStatus}
          count={mcpCount}
          unavailableCount={unavailableCount}
          onToggleDetails={() => setShowUnavailablePopover((v) => !v)}
        />
        <UnavailableServersPopover
          unavailableServers={unavailableServers}
          isOpen={showUnavailablePopover}
          onClose={() => setShowUnavailablePopover(false)}
        />
      </div>

      <Separator />

      <span
        title={
          autoMode
            ? "Modo Automático activo: Las escrituras y comandos no piden aprobación interactiva (validadas por Decisión 3)."
            : "Modo Interactivo: Las operaciones de modificación en el sistema requieren aprobación manual antes de actuar."
        }
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${autoMode
            ? "bg-yellow-950/30 text-yellow-300 border border-yellow-800/50 font-semibold"
            : "text-slate-400 hover:text-slate-300"
          }`}
      >
        {autoMode ? (
          <ShieldCheck className="w-3 h-3 text-yellow-400" />
        ) : (
          <Shield className="w-3 h-3 text-slate-400" />
        )}
        <span>Guard: {autoMode ? "Auto" : "Interactivo"}</span>
      </span>
    </div>
  );
};