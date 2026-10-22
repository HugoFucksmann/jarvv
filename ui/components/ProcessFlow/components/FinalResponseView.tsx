import React from "react";
import { CheckCheck } from "lucide-react";
import { MarkdownRenderer } from "../../Shared/MarkdownRenderer.tsx";
import { CopyButton } from "../../Shared/CopyButton.tsx";

interface FinalResponseViewProps {
  response: string;
  rawOutput?: string;
}

export const FinalResponseView: React.FC<FinalResponseViewProps> = ({ response, rawOutput }) => (
  <div className="flex flex-col gap-3 p-4 bg-slate-900/60 border border-slate-800 rounded-lg shadow-sm">
    {/* Cabecera con título y acciones de copiado */}
    <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
      <div className="flex items-center gap-2 text-xs font-mono font-medium text-emerald-400">
        <CheckCheck className="w-4 h-4 shrink-0" />
        <span>RESPUESTA FINAL SINTETIZADA</span>
      </div>
      <div className="flex items-center gap-2">
        {rawOutput && (
          <CopyButton
            text={rawOutput}
            label="Copiar raw"
            copiedLabel="Copiado raw"
            title="Copiar respuesta cruda íntegra del modelo (incluye traza de razonamiento si existe)"
            ariaLabel="Copiar respuesta cruda"
            iconSize="w-3.5 h-3.5"
            iconColor="text-indigo-400"
            className="gap-1.5 px-2.5 py-1 text-xs font-mono text-indigo-300 hover:text-white bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-800/50 rounded"
          />
        )}
        <CopyButton
          text={response}
          label="Copiar todo"
          title="Copiar respuesta completa en formato Markdown al portapapeles"
          ariaLabel="Copiar respuesta completa"
          iconSize="w-3.5 h-3.5"
          iconColor="text-slate-400"
          className="gap-1.5 px-2.5 py-1 text-xs font-mono text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 rounded"
        />
      </div>
    </div>

    {/* Markdown de alta fidelidad: código, tablas, listas y formato rico */}
    <MarkdownRenderer content={response} />
  </div>
);
