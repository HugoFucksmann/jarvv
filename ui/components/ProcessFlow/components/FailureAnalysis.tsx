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
    tone: "text-amber-400 bg-amber-950/40 border-amber-800/60",
    icon: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />,
  },
  no_alternatives: {
    label: "Sin alternativas viables",
    description: "El motor no encontró herramientas ni secuencias alternativas disponibles para continuar.",
    tone: "text-rose-400 bg-rose-950/40 border-rose-800/60",
    icon: <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />,
  },
  security_denied: {
    label: "Denegado por política de seguridad",
    description: "La operación fue rechazada por Guard o la lista negra debido a riesgos destructivos o acceso protegido.",
    tone: "text-rose-400 bg-rose-950/40 border-rose-800/60",
    icon: <ShieldX className="w-4 h-4 text-rose-400 shrink-0" />,
  },
  user_cancelled: {
    label: "Cancelada por el usuario",
    description: "La ejecución fue interrumpida intencionalmente a petición del usuario.",
    tone: "text-slate-400 bg-slate-900 border-slate-800",
    icon: <AlertOctagon className="w-4 h-4 text-slate-400 shrink-0" />,
  },
  replans_exhausted: {
    label: "Replanificaciones agotadas",
    description: "Se superó el límite de planes correctivos permitidos tras fallos repetidos.",
    tone: "text-amber-400 bg-amber-950/40 border-amber-800/60",
    icon: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />,
  },
  unrecoverable: {
    label: "Fallo no recuperable del sistema",
    description: "Ocurrió una falla crítica en un modelo de inferencia o en el catálogo de herramientas del servidor.",
    tone: "text-rose-400 bg-rose-950/40 border-rose-800/60",
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
    <div className="flex flex-col gap-3.5 p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm text-xs">
      {/* Motivo de parada */}
      {reasonInfo && (
        <div className={`flex items-start gap-3 p-3 rounded-lg border ${reasonInfo.tone}`}>
          <div className="mt-0.5">{reasonInfo.icon}</div>
          <div className="flex flex-col gap-0.5">
            <span className="font-mono font-semibold tracking-wide">
              {reasonInfo.label} ({stopReason})
            </span>
            <p className="text-slate-300 font-sans leading-relaxed text-[13px]">
              {reasonInfo.description}
            </p>
          </div>
        </div>
      )}

      {/* Auditoría de cambios en la PC */}
      <div className="flex flex-col gap-2 pt-1 border-t border-slate-800/60">
        <span className="font-mono font-semibold text-slate-300 tracking-wider text-[11px] uppercase">
          Estado de Cambios en el Equipo (Auditoría de Escrituras)
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
                <div key={`write-ok-${c.id || idx}`} className="pt-1 first:pt-0 font-mono text-[11px]">
                  <div className="flex items-center gap-2 text-emerald-300">
                    <Terminal className="w-3 h-3 text-emerald-400" />
                    <span className="font-semibold">{c.tool}</span>
                    <span className="text-slate-400 truncate max-w-md">
                      {formatCallArg(c.args)}
                    </span>
                  </div>
                  {c.summary && (
                    <p className="text-[11px] text-slate-400 font-sans mt-0.5 line-clamp-2">
                      {c.summary}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-slate-400 font-mono text-[11px] italic">
            • No se aplicaron modificaciones permanentes exitosas en el equipo.
          </p>
        )}

        {/* 2. Posibles cambios parciales o interrumpidos */}
        {potentialPartialWrites.length > 0 && (
          <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-amber-950/30 border border-amber-900/60 mt-1">
            <div className="flex items-center gap-1.5 text-amber-300 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>Posibles cambios parciales o interrumpidos ({potentialPartialWrites.length}):</span>
            </div>
            <p className="text-[11px] text-amber-200/80 font-sans leading-relaxed">
              Las siguientes operaciones de escritura fallaron o fueron interrumpidas a medio camino, por lo que pudieron dejar cambios incompletos:
            </p>
            <div className="flex flex-col gap-1 divide-y divide-amber-950/60 pl-5">
              {potentialPartialWrites.map((c: CallDto, idx: number) => (
                <div key={`write-fail-${c.id || idx}`} className="pt-1 first:pt-0 font-mono text-[11px]">
                  <div className="flex items-center gap-2 text-amber-300">
                    <FileCode className="w-3 h-3 text-amber-400" />
                    <span className="font-semibold">{c.tool}</span>
                    <span className="px-1 py-0.2 rounded bg-amber-900/60 text-amber-300 text-[10px]">
                      {c.status}
                    </span>
                    <span className="text-slate-400 truncate max-w-sm">
                      {formatCallArg(c.args)}
                    </span>
                  </div>
                  {c.reason && (
                    <p className="text-[11px] text-amber-400/90 font-mono mt-0.5">
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

