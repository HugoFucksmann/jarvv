import React from "react";
import { CheckCheck, Info } from "lucide-react";
import type { TaskResult } from "../../../types/api.ts";
import { MarkdownRenderer } from "../../Shared/MarkdownRenderer.tsx";
import { CopyButton } from "../../Shared/CopyButton.tsx";

interface FinalResponseViewProps {
  result: TaskResult;
}

export const FinalResponseView: React.FC<FinalResponseViewProps> = ({ result }) => (
  <div className="flex flex-col gap-3 p-4 bg-slate-900/60 border border-slate-800 rounded-lg shadow-sm">
    {/* Cabecera con título y acciones de copiado */}
    <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
      <div className="flex items-center gap-2 text-xs font-mono font-medium text-emerald-400">
        <CheckCheck className="w-4 h-4 shrink-0" />
        <span>RESPUESTA FINAL SINTETIZADA</span>
        {result.origin === "fallback" && (
          <span className="flex items-center gap-1 text-[11px] font-sans px-1.5 py-0.2 rounded bg-amber-950/70 text-amber-300 border border-amber-800/60 font-normal">
            <Info className="w-3 h-3" />
            <span>Respaldo automático (sin modelo)</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <CopyButton
          text={result.text}
          label="Copiar todo"
          title="Copiar respuesta completa en formato Markdown al portapapeles"
          ariaLabel="Copiar respuesta completa"
          iconSize="w-3.5 h-3.5"
          iconColor="text-slate-400"
          className="gap-1.5 px-2.5 py-1 text-xs font-mono text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 rounded"
        />
      </div>
    </div>

    {/* Markdown de alta fidelidad */}
    <MarkdownRenderer content={result.text} />
  </div>
);
