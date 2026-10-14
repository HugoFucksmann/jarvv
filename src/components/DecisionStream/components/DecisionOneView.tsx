import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { CoreEvent } from "../../../core/types.ts";

interface DecisionOneViewProps {
  d1Event?: CoreEvent;
}

export const DecisionOneView: React.FC<DecisionOneViewProps> = ({ d1Event }) => {
  if (!d1Event) return null;

  const [copiedRaw, setCopiedRaw] = useState(false);
  const data = (d1Event.data || {}) as any;
  const { route, confidence, needsContext, probabilities: directProbabilities, answers, rawOutput, rawInput } = data;
  const routeAnswer = answers?.route;
  const probabilities = directProbabilities || routeAnswer?.probabilities || {};

  const handleCopyRaw = async () => {
    const textToCopy = rawOutput || rawInput || JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    } catch (err) {
      console.error("Error al copiar raw Eos D1:", err);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3 bg-slate-900/40 border border-slate-800 rounded-lg text-xs font-mono">
      <div className="flex items-center justify-between text-slate-400">
        <span className="font-semibold text-slate-300">DECISION #1 — ROUTING</span>
        <div className="flex items-center gap-2">
          <span>Decision-2.0-Eos-0.8B</span>
          {(rawOutput || rawInput) && (
            <button
              type="button"
              onClick={handleCopyRaw}
              title="Copiar respuesta cruda original de Eos"
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {copiedRaw ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
              <span>{copiedRaw ? "Copiado" : "Copiar raw"}</span>
            </button>
          )}
        </div>
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
