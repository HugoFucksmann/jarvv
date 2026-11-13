import React from "react";
import { AlertOctagon, CheckCircle, AlertTriangle, ShieldX, Terminal, FileCode } from "lucide-react";
import type { TaskDto, StopReason, CallDto } from "../../../types/api.ts";

interface FailureAnalysisProps {
  task: TaskDto;
}

const STOP_REASON_DETAILS: Record<
  StopReason,
  { label: string; description: string; tone: string; icon: React.ReactNode }
> = {
  max_steps: {
    label: "Tope de pasos alcanzado",
    description: "La tarea agotó el presupuesto máximo de pasos sin lograr completar todos los objetivos.",
    tone: "text-yellow-300 bg-yellow-950/25 border-yellow-800/50",
    icon: <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />,
  },
  no_alternatives: {
    label: "Sin alternativas viables",
    description: "El motor no encontró herramientas ni secuencias alternativas disponibles para continuar.",
    tone: "text-rose-300 bg-rose-950/30 border-rose-800/50",
    icon: <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />,
  },
  security_denied: {
    label: "Denegado por política de seguridad",
    description: "La operación fue rechazada por Guard o la lista negra debido a riesgos destructivos o acceso protegido.",
    tone: "text-rose-300 bg-rose-950/30 border-rose-800/50",
    icon: <ShieldX className="w-4 h-4 text-rose-400 shrink-0" />,
  },
  user_cancelled: {
    label: "Cancelada por el usuario",
    description: "La ejecución fue interrumpida intencionalmente a petición del usuario.",
    tone: "text-slate-300 bg-slate-900 border-slate-800",
    icon: <AlertOctagon className="w-4 h-4 text-slate-400 shrink-0" />,
  },
  replans_exhausted: {
    label: "Replanificaciones agotadas",
    description: "Se superó el límite de planes correctivos permitidos tras fallos repetidos.",
    tone: "text-yellow-300 bg-yellow-950/25 border-yellow-800/50",
    icon: <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />,
  },
  unrecoverable: {
    label: "Fallo no recuperable del sistema",
    description: "Ocurrió una falla crítica en un modelo de inferencia o en el catálogo de herramientas del servidor.",
    tone: "text-rose-300 bg-rose-950/30 border-rose-800/50",
    icon: <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />,
  },
};

function formatCallArg(args: Record<string, unknown>): string {
  if (typeof args.command === "string") return args.command;
  if (typeof args.path === "string") return args.path;
  if (typeof args.input === "string") return args.input;
  return JSON.stringify(args);
}

export const FailureAnalysis: React.FC<FailureAnalysisProps> = ({ task }) => {
  const { state, stopReason } = task.task;
  const isFailedOrPartial = state === "partial" || state === "failed" || (state === "cancelled" && stopReason === "security_denied");

  if (!isFailedOrPartial) return null;

  const reasonInfo = stopReason ? STOP_REASON_DETAILS[stopReason] : null;

  // Filtrar escrituras de las llamadas
  const confirmedWrites = task.calls.filter(
    (c) => c.kind === "write" && c.status === "ok"
  );

  const potentialPartialWrites = task.calls.filter(
    (c) =>
      c.kind === "write" &&
      (c.status === "tool_error" || c.status === "exception" || c.status === "interrupted" || c.status === "waiting_input")
  );

  return (
    <div className="flex flex-col gap-3.5 p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs">
      {/* Motivo de parada */}
      {reasonInfo && (
        <div className={`flex items-start gap-3 p-3 rounded-lg border ${reasonInfo.tone}`}>
          <div className="mt-0.5">{reasonInfo.icon}</div>
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-sm">
              {reasonInfo.label} <span className="font-mono text-xs font-normal opacity-70">({stopReason})</span>
            </span>
            <p className="text-slate-300 leading-relaxed text-[13px]">
              {reasonInfo.description}
            </p>
          </div>
        </div>
      )}

      {/* Auditoría de cambios en la PC */}
      <div className="flex flex-col gap-2 pt-3 border-t border-slate-800">
        <span className="font-semibold text-slate-200 text-[13px]">
          Estado de cambios en el equipo
          <span className="font-normal text-slate-500"> · auditoría de escrituras</span>
        </span>

        {/* 1. Cambios que permanecen (escrituras ok) */}
        {confirmedWrites.length > 0 ? (
          <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-900/40">
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Cambios aplicados que permanecen en el sistema ({confirmedWrites.length}):</span>
            </div>
            <div className="flex flex-col gap-1 divide-y divide-emerald-950/60 pl-5">
              {confirmedWrites.map((c: CallDto, idx: number) => (
                <div key={`write-ok-${c.id || idx}`} className="pt-1 first:pt-0 text-xs">
                  <div className="flex items-center gap-2 text-emerald-300">
                    <Terminal className="w-3 h-3 text-emerald-400" />
                    <span className="font-semibold font-mono">{c.tool}</span>
                    <span className="text-slate-400 truncate max-w-md font-mono">
                      {formatCallArg(c.args)}
                    </span>
                  </div>
                  {c.summary && (
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                      {c.summary}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-slate-400 text-xs italic">
            • No se aplicaron modificaciones permanentes exitosas en el equipo.
          </p>
        )}

        {/* 2. Posibles cambios parciales o interrumpidos */}
        {potentialPartialWrites.length > 0 && (
          <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-yellow-950/25 border border-yellow-800/50 mt-1">
            <div className="flex items-center gap-1.5 text-yellow-300 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-yellow-400" />
              <span>Posibles cambios parciales o interrumpidos ({potentialPartialWrites.length}):</span>
            </div>
            <p className="text-xs text-yellow-100/80 leading-relaxed">
              Las siguientes operaciones de escritura fallaron o fueron interrumpidas a medio camino, por lo que pudieron dejar cambios incompletos:
            </p>
            <div className="flex flex-col gap-1 divide-y divide-yellow-950/60 pl-5">
              {potentialPartialWrites.map((c: CallDto, idx: number) => (
                <div key={`write-fail-${c.id || idx}`} className="pt-1 first:pt-0 text-xs">
                  <div className="flex items-center gap-2 text-yellow-300">
                    <FileCode className="w-3 h-3 text-yellow-400" />
                    <span className="font-semibold font-mono">{c.tool}</span>
                    <span className="px-1.5 py-0.5 rounded bg-yellow-900/40 text-yellow-300 text-[11px] font-mono">
                      {c.status}
                    </span>
                    <span className="text-slate-400 truncate max-w-sm font-mono">
                      {formatCallArg(c.args)}
                    </span>
                  </div>
                  {c.reason && (
                    <p className="text-xs text-yellow-200/90 mt-0.5">
                      Motivo: {c.reason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};