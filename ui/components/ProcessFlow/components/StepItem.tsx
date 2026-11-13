import React, { memo, useState } from "react";
import { ChevronDown, ChevronRight, Terminal, FileText, Clock, ShieldCheck, ShieldAlert, ListTree } from "lucide-react";
import type { CallDto, StepDto } from "../../../types/api.ts";
import { STEP_STATE_LABELS } from "../../../utils/taskStatus.ts";
import { getRouteLabel } from "../../../utils/routeLabels.ts";
import { CopyButton } from "../../Shared/CopyButton.tsx";
import { StepStatusIcon } from "../../Shared/StepStatusIcon.tsx";

interface StepItemProps {
  step: StepDto;
  calls: CallDto[];
  index: number;
  isCurrent: boolean;
  isLast?: boolean;
  onViewRef?: (refId: string) => void;
  /** Abre el inspector de consultas a modelos de esa llamada (solo con la tarea terminada). */
  onViewQueries?: (callId: string) => void;
}

function callStatusTone(status?: string): string {
  if (status === "ok") return "text-emerald-400";
  if (status === "no_data" || status === "not_found") return "text-yellow-400";
  return status ? "text-rose-400" : "text-slate-400";
}

function callVerdictLabel(call: CallDto): string {
  if (call.verdict === "approved") return "VERIFICADO (Aprobado)";
  if (call.verdict === "rejected") return "RECHAZADO";
  switch (call.status) {
    case "ok":
      return "OK";
    case "no_data":
      return "SIN DATOS";
    case "not_found":
      return "NO ENCONTRADO";
    case "tool_error":
      return "ERROR DE HERRAMIENTA";
    case "exception":
      return "EXCEPCIÓN";
    case "interrupted":
      return "INTERRUMPIDO";
    case "waiting_input":
      return "ESPERANDO RESPUESTA";
    case "denied":
      return "DENEGADO";
    case "user_rejected":
      return "RECHAZADO POR USUARIO";
    case "tool_rejected":
      return "RECHAZADO POR HERRAMIENTA";
    default:
      return call.status ? call.status.toUpperCase() : "EJECUTADO";
  }
}

const OutputViewer: React.FC<{ text: string; copyTitle: string; className?: string }> = ({
  text,
  copyTitle,
  className = "",
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-accent-400 hover:text-accent-300 cursor-pointer"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span>Salida completa ({text.length} caracteres)</span>
        </button>
        <CopyButton
          text={text}
          title={copyTitle}
          iconSize="w-2.5 h-2.5"
          className="gap-1 text-[11px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-slate-800"
        />
      </div>
      {expanded && (
        <div className="p-2 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-slate-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
          {text}
        </div>
      )}
    </div>
  );
};

const StepItemBase: React.FC<StepItemProps> = ({
  step,
  calls,
  index,
  isCurrent,
  isLast = false,
  onViewRef,
  onViewQueries,
}) => {
  const [showCalls, setShowCalls] = useState(false);
  const callsCount = calls.length;

  // En modo reactivo instruction suele ser null: inferimos del contenido de las llamadas
  const displayInstruction =
    step.instruction ||
    (callsCount > 0
      ? `Llamada a ${calls.map((c) => c.tool).join(", ")}`
      : `Iteración #${index + 1}`);

  const effectiveRoute = step.route || calls[0]?.route || null;

  return (
    <div
      className={`relative flex flex-col gap-2 py-3 px-3.5 rounded-xl transition-colors ${step.superseded
          ? "opacity-50"
          : isCurrent
            ? "bg-slate-900 ring-1 ring-inset ring-accent-500/20"
            : "hover:bg-slate-900/40"
        }`}
    >
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[1.45rem] top-9 -bottom-2 w-px bg-slate-800"
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5">
            <StepStatusIcon state={step.state} />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="font-mono text-slate-500 tabular-nums">#{index + 1}</span>
              {effectiveRoute && (
                <span className="text-slate-400 font-medium">
                  {getRouteLabel(effectiveRoute)}
                </span>
              )}
              {step.at && (
                <span className="text-[11px] text-slate-500 flex items-center gap-1 tabular-nums">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{new Date(step.at).toLocaleTimeString()}</span>
                </span>
              )}
              {step.superseded && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-950/50 text-rose-400 border border-rose-900/50">
                  Descartado (replan)
                </span>
              )}
            </div>

            <p
              className={`text-sm ${step.superseded ? "line-through text-slate-500" : "text-slate-100"
                }`}
            >
              {displayInstruction}
            </p>

            {step.expected && !step.superseded && (
              <p className="text-xs text-slate-400 mt-0.5">
                <span className="text-slate-500">Esperado:</span> {step.expected}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs shrink-0">
          <span className="text-slate-400">{STEP_STATE_LABELS[step.state] || step.state}</span>
        </div>
      </div>

      {/* Historial de llamadas a herramientas asociadas a este paso */}
      {callsCount > 0 && (
        <div className="ml-7 mt-1">
          <button
            type="button"
            onClick={() => setShowCalls((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-accent-400 hover:text-accent-300 transition-colors cursor-pointer"
          >
            {showCalls ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span>
              {callsCount} llamada{callsCount > 1 ? "s" : ""} a herramientas
            </span>
          </button>

          {showCalls && (
            <div className="mt-2 flex flex-col divide-y divide-slate-800/60 border-l border-slate-800 pl-3">
              {calls.map((c, cIdx) => {
                const tone = callStatusTone(c.status);
                const verdict = callVerdictLabel(c);

                return (
                  <div key={`call-${c.id || cIdx}`} className="py-2.5 text-xs">
                    <div className="flex items-center justify-between text-slate-400 mb-1 flex-wrap gap-1.5">
                      <div className="flex items-center gap-1.5 text-slate-100 font-semibold flex-wrap">
                        <Terminal className="w-3 h-3 text-accent-400" />
                        <span className="font-mono">{c.tool}</span>
                        <span
                          className={`text-[11px] font-mono font-normal px-1.5 py-0.5 rounded ${c.kind === "write"
                              ? "bg-yellow-950/40 text-yellow-300 border border-yellow-800/50"
                              : "bg-slate-800 text-slate-300"
                            }`}
                        >
                          {c.kind}
                        </span>
                        {c.ref && (
                          <button
                            type="button"
                            onClick={() => onViewRef?.(c.ref!)}
                            className="flex items-center gap-1 text-[11px] font-normal px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                            title={`Ver contenido completo de referencia ${c.ref}`}
                          >
                            <FileText className="w-2.5 h-2.5 text-accent-400" />
                            <span className="font-mono">{c.ref}</span>
                            <span className="text-[10px] underline text-slate-400">ver</span>
                          </button>
                        )}
                        {onViewQueries && (
                          <button
                            type="button"
                            onClick={() => onViewQueries(c.id)}
                            className="flex items-center gap-1 text-[11px] font-normal px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                            title="Ver entradas y salidas de los modelos de esta llamada"
                          >
                            <ListTree className="w-2.5 h-2.5 text-accent-400" />
                            <span>modelos</span>
                          </button>
                        )}
                        {c.at && (
                          <span className="text-[11px] text-slate-500 font-normal tabular-nums">
                            {new Date(c.at).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {c.verdict === "approved" && (
                          <span className="flex items-center gap-0.5 text-[11px] text-emerald-400 font-semibold bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-800/50">
                            <ShieldCheck className="w-2.5 h-2.5" />
                            <span>D4 Verificado</span>
                          </span>
                        )}
                        {c.verdict === "rejected" && (
                          <span className="flex items-center gap-0.5 text-[11px] text-rose-400 font-semibold bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-800/50">
                            <ShieldAlert className="w-2.5 h-2.5" />
                            <span>D4 Rechazado</span>
                          </span>
                        )}
                        <span className={`text-[11px] font-bold ${tone}`} title={c.status}>
                          {verdict}
                        </span>
                      </div>
                    </div>

                    {c.args && Object.keys(c.args).length > 0 && (
                      <div className="text-xs font-mono text-slate-400 truncate mb-1">
                        <span className="text-slate-500">args: </span>
                        {JSON.stringify(c.args)}
                      </div>
                    )}

                    {c.sig && (
                      <div className="text-[11px] text-slate-500 font-mono truncate mb-1">
                        <span className="text-slate-600">sig: </span>
                        {c.sig}
                      </div>
                    )}

                    {c.summary && (
                      <p className="text-[13px] text-slate-300 line-clamp-3">
                        {c.summary}
                      </p>
                    )}

                    {c.reason && (
                      <p className="text-xs text-yellow-300/80 mt-0.5">
                        Motivo: {c.reason}
                      </p>
                    )}

                    {c.summary && (
                      <OutputViewer
                        text={c.summary}
                        copyTitle="Copiar salida de herramienta"
                        className="mt-1.5"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const StepItem = memo(StepItemBase);