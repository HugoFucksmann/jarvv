import React, { useState } from "react";
import type { CoreEvent } from "../../core/types.ts";
import { DecisionOneView } from "./components/DecisionOneView.tsx";
import { DecisionTwoView } from "./components/DecisionTwoView.tsx";
import { Activity, ChevronDown, ChevronRight, Cpu } from "lucide-react";

interface DecisionStreamProps {
  events: CoreEvent[];
  isExecuting?: boolean;
}

export const DecisionStream: React.FC<DecisionStreamProps> = ({ events, isExecuting = false }) => {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [showFullTrace, setShowFullTrace] = useState(false);

  const d1Event = [...events].reverse().find((e: CoreEvent) => e.type === "DECISION_ONE");
  const d2Event = [...events].reverse().find((e: CoreEvent) => e.type === "DECISION_TWO");

  if (events.length === 0) return null;

  // Mientras la tarea se ejecuta, mostrar detalle completo; al terminar, colapsar por defecto
  const isCardsExpanded = userExpanded !== null ? userExpanded : isExecuting;

  const relevantTraceEvents = events.filter((e) =>
    [
      "DECISION_ONE",
      "DECISION_TWO",
      "ARGUMENTS_GENERATED",
      "GUARD_EVALUATION",
      "APPROVAL_REQUESTED",
      "APPROVAL_RESOLVED",
      "MCP_DISPATCHED",
      "MCP_RESULT",
      "RESULT_PROCESSED",
      "PLAN_GENERATED",
      "FINAL_RESPONSE",
    ].includes(e.type)
  );

  const d1Data = (d1Event?.data || {}) as any;
  const d2Data = (d2Event?.data || {}) as any;
  const route = d1Data.route || "N/A";
  const confidencePct = typeof d1Data.confidence === "number" ? `${(d1Data.confidence * 100).toFixed(0)}%` : null;
  const tool = d2Data.tool || null;

  return (
    <div className="flex flex-col gap-2 px-6 py-2">
      {/* 1. Modo Compacto vs Expandido para Tarjetas de Decisión (Etapa B.4) */}
      {(d1Event || d2Event) && (
        <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-900/30 overflow-hidden text-xs">
          {/* Barra compacta de resumen (visible cuando las tarjetas están colapsadas) */}
          {!isCardsExpanded ? (
            <div className="flex items-center justify-between px-3.5 py-2 text-slate-300 font-mono text-[11px] bg-slate-950/40">
              <div className="flex items-center gap-2 flex-wrap">
                <Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="text-slate-400 font-medium">Decisiones Core:</span>
                <span className="text-sky-300 font-semibold">{route}</span>
                {confidencePct && <span className="text-emerald-400">({confidencePct})</span>}
                {tool && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-400">Tool:</span>
                    <span className="text-emerald-300 font-semibold">{tool}</span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setUserExpanded(true)}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-sky-300 transition-colors cursor-pointer ml-2"
              >
                <span>Ver tarjetas</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-2.5">
              <div className="flex items-center justify-between px-1 text-[11px] font-mono text-slate-400">
                <div className="flex items-center gap-1.5">
                  <Cpu className="w-3 h-3 text-sky-400" />
                  <span className="text-slate-300 font-medium">Modelos de Decisión 2.0 (Eos-0.8B)</span>
                </div>
                {!isExecuting && (
                  <button
                    type="button"
                    onClick={() => setUserExpanded(false)}
                    className="flex items-center gap-1 text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    <span>Colapsar</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <DecisionOneView d1Event={d1Event} />
                <DecisionTwoView d2Event={d2Event} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. Traza de Eventos Operativos en Vivo (Colapsable) */}
      {relevantTraceEvents.length > 0 && (
        <div className="flex flex-col border border-slate-800/80 rounded-lg bg-slate-900/30 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setShowFullTrace(!showFullTrace)}
            className="flex items-center justify-between px-3 py-2 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer bg-slate-950/40"
          >
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span>Traza de Eventos Operativos en Vivo</span>
              <span className="text-slate-500">({relevantTraceEvents.length} eventos)</span>
            </div>
            {showFullTrace ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {showFullTrace && (
            <div className="flex flex-col divide-y divide-slate-800/50 max-h-48 overflow-y-auto font-mono text-[11px] p-1">
              {[...relevantTraceEvents].reverse().map((ev, idx) => (
                <div key={idx} className="flex items-start gap-2.5 py-1.5 px-2 hover:bg-slate-900/50 rounded">
                  <span className="text-slate-500 shrink-0 tabular-nums">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={`font-semibold shrink-0 ${
                      ev.type.startsWith("DECISION")
                        ? "text-sky-300"
                        : ev.type.startsWith("GUARD") || ev.type.startsWith("APPROVAL")
                        ? "text-amber-300"
                        : ev.type.startsWith("MCP")
                        ? "text-emerald-300"
                        : "text-slate-300"
                    }`}
                  >
                    [{ev.type}]
                  </span>
                  <span className="text-slate-400 truncate flex-1">
                    {ev.type === "ARGUMENTS_GENERATED"
                      ? `args: ${JSON.stringify(ev.data?.args || {})}`
                      : ev.type === "GUARD_EVALUATION"
                      ? `decisión: ${(ev.data?.guardDecision as any)?.decision || "ALLOW"}`
                      : ev.type === "MCP_DISPATCHED"
                      ? `${ev.data?.mcp}:${ev.data?.tool}`
                      : ev.type === "DECISION_ONE"
                      ? `ruta: ${ev.data?.route} (conf: ${((Number(ev.data?.confidence) || 0) * 100).toFixed(0)}%)`
                      : ev.type === "DECISION_TWO"
                      ? `tool: ${ev.data?.tool}`
                      : ev.type === "FINAL_RESPONSE"
                      ? "Respuesta sintetizada"
                      : JSON.stringify(ev.data || {})}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
