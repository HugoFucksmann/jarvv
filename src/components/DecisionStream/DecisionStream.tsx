import React, { useState } from "react";
import type { CoreEvent } from "../../core/types.ts";
import { DecisionOneView } from "./components/DecisionOneView.tsx";
import { DecisionTwoView } from "./components/DecisionTwoView.tsx";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";

interface DecisionStreamProps {
  events: CoreEvent[];
}

export const DecisionStream: React.FC<DecisionStreamProps> = ({ events }) => {
  const [showFullTrace, setShowFullTrace] = useState(false);

  const d1Event = [...events].reverse().find((e: CoreEvent) => e.type === "DECISION_ONE");
  const d2Event = [...events].reverse().find((e: CoreEvent) => e.type === "DECISION_TWO");

  if (events.length === 0) return null;

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

  return (
    <div className="flex flex-col gap-2 px-6 py-2">
      {/* 1. Primary Decision Cards */}
      {(d1Event || d2Event) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DecisionOneView d1Event={d1Event} />
          <DecisionTwoView d2Event={d2Event} />
        </div>
      )}

      {/* 2. Operational Event Stream Accordion (FUNC-03) */}
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
