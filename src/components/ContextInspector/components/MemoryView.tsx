import React from "react";
import { TaskMemory } from "../../../core/types.ts";
import { Terminal, Database, AlertOctagon } from "lucide-react";

interface MemoryViewProps {
  memory?: TaskMemory;
}

export const MemoryView: React.FC<MemoryViewProps> = ({ memory }) => {
  if (!memory) {
    return (
      <div className="text-slate-500 font-mono text-xs">
        No hay registros en la memoria operativa v2.1 de la tarea.
      </div>
    );
  }

  const { log = [], facts = {}, fail = [] } = memory;
  const factsEntries = Object.entries(facts);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
      {/* 1. LOG Operativo */}
      <div className="flex flex-col gap-2 p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
        <div className="flex items-center gap-1.5 text-sky-400 font-semibold border-b border-slate-800 pb-1.5">
          <Terminal className="w-3.5 h-3.5" />
          <span>LOG ({log.length})</span>
        </div>
        {log.length === 0 ? (
          <span className="text-slate-600 text-[11px]">Sin entradas de log</span>
        ) : (
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
            {log.map((entry, idx) => (
              <div key={idx} className="text-slate-300 text-[11px] leading-relaxed border-l border-sky-900/50 pl-2">
                {entry}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. FACTS Descubiertos */}
      <div className="flex flex-col gap-2 p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
        <div className="flex items-center gap-1.5 text-emerald-400 font-semibold border-b border-slate-800 pb-1.5">
          <Database className="w-3.5 h-3.5" />
          <span>FACTS ({factsEntries.length})</span>
        </div>
        {factsEntries.length === 0 ? (
          <span className="text-slate-600 text-[11px]">Sin hechos registrados</span>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
            {factsEntries.map(([key, val]) => (
              <div key={key} className="flex flex-col bg-slate-950/60 p-1.5 rounded border border-slate-800/60">
                <span className="text-emerald-300 font-medium text-[11px]">{key}</span>
                <span className="text-slate-400 text-[11px] break-all">{val}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. FAIL / Errores Conocidos */}
      <div className="flex flex-col gap-2 p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
        <div className="flex items-center gap-1.5 text-rose-400 font-semibold border-b border-slate-800 pb-1.5">
          <AlertOctagon className="w-3.5 h-3.5" />
          <span>FAIL ({fail.length})</span>
        </div>
        {fail.length === 0 ? (
          <span className="text-slate-600 text-[11px]">Sin fallos registrados</span>
        ) : (
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
            {fail.map((entry, idx) => (
              <div key={idx} className="text-rose-300 text-[11px] leading-relaxed border-l border-rose-900/60 pl-2">
                {entry}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
