import React from "react";
import { CoreEvent } from "../../../core/types.ts";

interface DecisionOneViewProps {
  d1Event?: CoreEvent;
}

export const DecisionOneView: React.FC<DecisionOneViewProps> = ({ d1Event }) => {
  if (!d1Event) return null;

  const { route, confidence, needsContext, answers } = d1Event.data as any;
  const routeAnswer = answers?.route;
  const probabilities = routeAnswer?.probabilities || {};

  return (
    <div className="flex flex-col gap-2 p-3 bg-slate-900/40 border border-slate-800 rounded-lg text-xs font-mono">
      <div className="flex items-center justify-between text-slate-400">
        <span className="font-semibold text-slate-300">DECISION #1 — ROUTING</span>
        <span>Decision-2.0-Kai-0.6B</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 py-1 text-slate-300">
        <div>
          <span className="text-slate-500">Ruta: </span>
          <span className="text-sky-300 font-medium font-sans">
            {route === "fin" ? "Fin (Terminación)" : route}
          </span>
        </div>
        <div>
          <span className="text-slate-500">Confianza: </span>
          <span className="text-emerald-400">
            {typeof confidence === "number" ? `${(confidence * 100).toFixed(1)}%` : "N/A"}
          </span>
        </div>
        <div>
          <span className="text-slate-500">Contexto: </span>
          <span className={needsContext ? "text-amber-300" : "text-slate-400"}>
            {needsContext ? "Ampliar (>= 0.6)" : "Estándar"}
          </span>
        </div>
      </div>

      {/* Probabilities breakdown */}
      {Object.keys(probabilities).length > 0 && (
        <div className="flex items-center gap-3 pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
          <span className="text-slate-500">Probabilidades:</span>
          {Object.entries(probabilities).map(([key, val]) => (
            <span key={key} className={key === route ? "text-sky-300 font-semibold" : ""}>
              {key}: {(Number(val) * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
