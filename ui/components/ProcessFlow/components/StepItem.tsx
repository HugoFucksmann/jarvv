import React, { memo, useState } from "react";
import { ChevronDown, ChevronRight, Terminal, FileText, Clock, ShieldCheck, ShieldAlert } from "lucide-react";
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
}

function callStatusTone(status?: string): string {
  if (status === "ok") return "text-emerald-400";
  if (status === "no_data" || status === "not_found") return "text-amber-400";
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
          className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 cursor-pointer font-mono"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span>Salida completa ({text.length} caracteres)</span>
        </button>
        <CopyButton
          text={text}
          title={copyTitle}
          iconSize="w-2.5 h-2.5"
          className="gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-slate-800"
        />
      </div>
      {expanded && (
        <div className="p-2 bg-slate-950/70 rounded text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
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
      className={`relative flex flex-col gap-2 py-3 px-3.5 rounded-xl transition-colors ${
        step.superseded
          ? "opacity-50"
          : isCurrent
          ? "bg-slate-900/60"
          : "hover:bg-slate-900/30"
      }`}
    >
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[1.45rem] top-9 -bottom-2 w-px bg-slate-800"
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <StepStatusIcon state={step.state} />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-slate-500 tabular-nums">#{index + 1}</span>
              {effectiveRoute && (
                <span className="font-mono text-slate-400 font-medium">
                  {getRouteLabel(effectiveRoute)}
                </span>
              )}
              {step.at && (
                <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{new Date(step.at).toLocaleTimeString()}</span>
                </span>
              )}
              {step.superseded && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-950/50 text-rose-400 border border-rose-900/50">
                  Descartado (replan)
                </span>
              )}
            </div>

            <p
              className={`text-sm ${
                step.superseded ? "line-through text-slate-500" : "text-slate-200"
              }`}
            >
              {displayInstruction}
            </p>

            {step.expected && !step.superseded && (
              <p className="text-xs text-emerald-400/70 font-mono mt-0.5">
                Esperado: {step.expected}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono shrink-0">
          <span className="text-slate-400">{STEP_STATE_LABELS[step.state] || step.state}</span>
        </div>
      </div>

      {/* Historial de llamadas a herramientas asociadas a este paso */}
      {callsCount > 0 && (
        <div className="ml-7 mt-1">
          <button
            type="button"
            onClick={() => setShowCalls((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-sky-400/90 hover:text-sky-300 font-mono transition-colors cursor-pointer"
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
                  <div key={`call-${c.id || cIdx}`} className="py-2.5 text-xs font-mono">
                    <div className="flex items-center justify-between text-slate-400 mb-1 flex-wrap gap-1">
                      <div className="flex items-center gap-1.5 text-sky-300 font-semibold flex-wrap">
                        <Terminal className="w-3 h-3 text-sky-400" />
                        <span>{c.tool}</span>
                        <span
                          className={`text-[10px] px-1 py-0.2 rounded ${
                            c.kind === "write"
                              ? "bg-amber-950/70 text-amber-300 border border-amber-800/60"
                              : "bg-slate-800 text-slate-300"
                          }`}
                        >
                          {c.kind}
                        </span>
                        {c.ref && (
                          <button
                            type="button"
                            onClick={() => onViewRef?.(c.ref!)}
                            className="flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-800/60 transition-colors cursor-pointer"
                            title={`Ver contenido completo de referencia ${c.ref}`}
                          >
                            <FileText className="w-2.5 h-2.5" />
                            <span>{c.ref}</span>
                            <span className="text-[9px] underline">ver</span>
                          </button>
                        )}
                        {c.at && (
                          <span className="text-[10px] text-slate-500 font-normal">
                            {new Date(c.at).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {c.verdict === "approved" && (
                          <span className="flex items-center gap-0.5 text-[10px] text-emerald-400 font-semibold bg-emerald-950/50 px-1 py-0.2 rounded border border-emerald-800/50">
                            <ShieldCheck className="w-2.5 h-2.5" />
                            <span>D4 Verificado</span>
                          </span>
                        )}
                        {c.verdict === "rejected" && (
                          <span className="flex items-center gap-0.5 text-[10px] text-rose-400 font-semibold bg-rose-950/50 px-1 py-0.2 rounded border border-rose-800/50">
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
                      <div className="text-[11px] text-slate-400 truncate mb-1">
                        <span className="text-slate-500">args: </span>
                        {JSON.stringify(c.args)}
                      </div>
                    )}

                    {c.sig && (
                      <div className="text-[10px] text-slate-500 font-mono truncate mb-1">
                        <span className="text-slate-600">sig: </span>
                        {c.sig}
                      </div>
                    )}

                    {c.summary && (
                      <p className="text-[12px] text-slate-300 font-sans line-clamp-3">
                        {c.summary}
                      </p>
                    )}

                    {c.reason && (
                      <p className="text-[11px] text-amber-300/80 font-mono mt-0.5">
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
