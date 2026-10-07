import React from "react";
import { CoreEvent } from "../../../core/types.ts";

interface DecisionTwoViewProps {
  d2Event?: CoreEvent;
}

export const DecisionTwoView: React.FC<DecisionTwoViewProps> = ({ d2Event }) => {
  if (!d2Event) return null;

  const { tool, confidence, probabilities } = d2Event.data as any;

  return (
    <div className="flex flex-col gap-2 p-3 bg-slate-900/40 border border-slate-800 rounded-lg text-xs font-mono">
      <div className="flex items-center justify-between text-slate-400">
        <span className="font-semibold text-slate-300">DECISION #2 — TOOL SELECTION</span>
        <span>Confianza: {(Number(confidence || 0) * 100).toFixed(0)}%</span>
      </div>

      <div className="flex items-center gap-2 text-slate-300">
        <span className="text-slate-500">Herramienta Seleccionada: </span>
        <span className="text-emerald-300 font-semibold font-sans">
          {tool}
        </span>
      </div>

      {probabilities && Object.keys(probabilities).length > 0 && (
        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
          <span className="text-slate-500">Distribución:</span>
          {Object.entries(probabilities)
            .sort(([, a], [, b]) => Number(b) - Number(a))
            .slice(0, 4)
            .map(([key, val]) => (
              <span key={key} className={key === tool ? "text-emerald-300 font-medium" : ""}>
                {key}: {(Number(val) * 100).toFixed(0)}%
              </span>
            ))}
        </div>
      )}
    </div>
  );
};
