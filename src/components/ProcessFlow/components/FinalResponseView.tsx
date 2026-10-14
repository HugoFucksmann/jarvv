import React, { useState } from "react";
import { CheckCheck, Copy, Check } from "lucide-react";
import { MarkdownRenderer } from "../../Shared/MarkdownRenderer.tsx";

interface FinalResponseViewProps {
  response: string;
  rawOutput?: string;
}

export const FinalResponseView: React.FC<FinalResponseViewProps> = ({ response, rawOutput }) => {
  const [copiedFull, setCopiedFull] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);

  const handleCopyFull = async () => {
    try {
      await navigator.clipboard.writeText(response);
      setCopiedFull(true);
      setTimeout(() => setCopiedFull(false), 2000);
    } catch (err) {
      console.error("Error al copiar respuesta:", err);
    }
  };

  const handleCopyRaw = async () => {
    if (!rawOutput) return;
    try {
      await navigator.clipboard.writeText(rawOutput);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    } catch (err) {
      console.error("Error al copiar respuesta cruda:", err);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 bg-slate-900/60 border border-slate-800 rounded-lg shadow-sm">
      {/* Cabecera con título y acciones de copiado */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2 text-xs font-mono font-medium text-emerald-400">
          <CheckCheck className="w-4 h-4 shrink-0" />
          <span>RESPUESTA FINAL SINTETIZADA</span>
        </div>
        <div className="flex items-center gap-2">
          {rawOutput && (
            <button
              type="button"
              onClick={handleCopyRaw}
              title="Copiar respuesta cruda íntegra del modelo (incluye traza de razonamiento si existe)"
              aria-label="Copiar respuesta cruda"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono text-indigo-300 hover:text-white bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-800/50 rounded transition-colors cursor-pointer"
            >
              {copiedRaw ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copiado raw</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Copiar raw</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopyFull}
            title="Copiar respuesta completa en formato Markdown al portapapeles"
            aria-label="Copiar respuesta completa"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 rounded transition-colors cursor-pointer"
          >
            {copiedFull ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copiar todo</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Renderizado de Markdown de alta fidelidad con código, tablas, listas y formato rico */}
      <MarkdownRenderer content={response} />
    </div>
  );
};
