import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { CoreEvent } from "../../../core/types.ts";

interface DecisionTwoViewProps {
  d2Event?: CoreEvent;
}

export const DecisionTwoView: React.FC<DecisionTwoViewProps> = ({ d2Event }) => {
  if (!d2Event) return null;

  const [copiedRaw, setCopiedRaw] = useState(false);
  const data = (d2Event.data || {}) as any;
  const { tool, confidence, probabilities, rawOutput, rawInput } = data;

  const handleCopyRaw = async () => {
    const textToCopy = rawOutput || rawInput || JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    } catch (err) {
      console.error("Error al copiar raw Eos D2:", err);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3 bg-slate-900/40 border border-slate-800 rounded-lg text-xs font-mono">
      <div className="flex items-center justify-between text-slate-400">
        <span className="font-semibold text-slate-300">DECISION #2 — TOOL SELECTION</span>
        <div className="flex items-center gap-2">
          <span>Confianza: {(Number(confidence || 0) * 100).toFixed(0)}%</span>
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
