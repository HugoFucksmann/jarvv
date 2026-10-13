import React, { useState } from "react";
import type { TaskMemory, Step } from "../../../core/types.ts";
import { Terminal, Database, AlertOctagon, Sparkles, BookOpen, ExternalLink, Loader2, X } from "lucide-react";
import { jarvisApi } from "../../../services/jarvisApi.ts";

interface MemoryViewProps {
  memory?: TaskMemory;
  steps?: Step[];
  taskId?: string;
}

export const MemoryView: React.FC<MemoryViewProps> = ({ memory, steps = [], taskId }) => {
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [refContent, setRefContent] = useState<string | null>(null);
  const [isLoadingRef, setIsLoadingRef] = useState<boolean>(false);
  const [refError, setRefError] = useState<string | null>(null);

  if (!memory) {
    return (
      <div className="text-slate-500 font-mono text-xs">
        No hay registros en la memoria operativa de la tarea.
      </div>
    );
  }

  const { log = [], facts = {}, fail = [], effects = [] } = memory;
  const factsEntries = Object.entries(facts);

  // Extract all step handoffs and references from steps
  const handoffs = steps
    .filter((s) => Boolean(s.handoff))
    .map((s) => s.handoff!);

  // Extract all ref keys mentioned in handoffs, facts or effects
  const collectedRefKeys = Array.from(
    new Set([
      ...handoffs.filter((h) => Boolean(h.refKey)).map((h) => h.refKey!),
      ...Object.values(facts)
        .flatMap((v) => (v.match(/ref:r\w+/g) || []))
        .map((r) => r.replace("ref:", "")),
    ])
  );

  const handleInspectRef = async (refKey: string) => {
    setSelectedRef(refKey);
    setRefContent(null);
    setRefError(null);
    setIsLoadingRef(true);

    try {
      const normalizedKey = refKey.startsWith("ref:") ? refKey : `ref:${refKey}`;
      const res = await jarvisApi.getRef(normalizedKey, taskId);
      if (res && res.found) {
        setRefContent(res.content);
      } else {
        setRefError(`No se encontró contenido en RefStore para '${normalizedKey}'.`);
      }
    } catch (err: any) {
      setRefError(err?.message || "Error al consultar la referencia temporal en RefStore.");
    } finally {
      setIsLoadingRef(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 text-xs font-mono">
      {/* Modal / Panel de Inspección de Referencia Temporal */}
      {selectedRef && (
        <div className="p-3 bg-slate-900 border border-sky-800 rounded-lg shadow-lg flex flex-col gap-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <div className="flex items-center gap-1.5 text-sky-300 font-semibold">
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Contenido íntegro en RefStore: ref:{selectedRef.replace("ref:", "")}</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedRef(null)}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {isLoadingRef && (
            <div className="flex items-center gap-2 text-slate-400 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
              <span>Cargando contenido desde el servidor...</span>
            </div>
          )}

          {refError && (
            <div className="text-rose-400 text-[11px] py-1">{refError}</div>
          )}

          {refContent && (
            <div className="max-h-40 overflow-y-auto p-2 bg-slate-950 rounded border border-slate-800 text-[11px] text-slate-200 whitespace-pre-wrap break-all">
              {refContent}
            </div>
          )}
        </div>
      )}

      {/* Grid de 4 Columnas: LOG, FACTS, EFFECTS, FAIL */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 1. LOG Continuo Operativo (sin colapso estadístico) */}
        <div className="flex flex-col gap-2 p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between text-sky-400 font-semibold border-b border-slate-800 pb-1.5">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              <span>LOG ({log.length})</span>
            </div>
            <span className="text-[10px] text-slate-500 font-normal">Hasta 30 líns.</span>
          </div>
          {log.length === 0 ? (
            <span className="text-slate-600 text-[11px]">Sin entradas de log</span>
          ) : (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
              {log.map((entry, idx) => (
                <div key={idx} className="text-slate-300 text-[11px] leading-relaxed border-l border-sky-900/50 pl-2 break-all">
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

        {/* 3. EFFECTS (Capa de efectos secundarios mutativos confirmados) */}
        <div className="flex flex-col gap-2 p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
          <div className="flex items-center gap-1.5 text-indigo-400 font-semibold border-b border-slate-800 pb-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            <span>EFFECTS ({effects.length})</span>
          </div>
          {effects.length === 0 ? (
            <span className="text-slate-600 text-[11px]">Sin efectos secundarios</span>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
              {effects.map((eff, idx) => (
                <div key={idx} className="flex flex-col bg-slate-950/60 p-1.5 rounded border border-indigo-900/40 text-indigo-200">
                  <span className="text-[11px] break-all">{eff}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. FAIL / Errores Conocidos */}
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

      {/* 5. LEDGER DE HANDOFFS Y REFERENCIAS TEMPORALES */}
      {(handoffs.length > 0 || collectedRefKeys.length > 0) && (
        <div className="flex flex-col gap-2 p-3 bg-slate-900/40 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
              <BookOpen className="w-3.5 h-3.5" />
              <span>LEDGER DE HANDOFFS DETERMINISTAS ({handoffs.length})</span>
            </div>
            {collectedRefKeys.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-slate-500 text-[10px]">RefStore:</span>
                {collectedRefKeys.map((rk) => (
                  <button
                    key={rk}
                    type="button"
                    onClick={() => handleInspectRef(rk)}
                    className="px-1.5 py-0.5 rounded bg-sky-950 hover:bg-sky-900 text-sky-300 border border-sky-800/80 text-[10px] cursor-pointer transition-colors flex items-center gap-1"
                    title={`Inspeccionar contenido de ref:${rk}`}
                  >
                    <span>ref:{rk}</span>
                    <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col divide-y divide-slate-800/50 max-h-44 overflow-y-auto">
            {handoffs.map((h, hIdx) => (
              <div key={hIdx} className="flex items-start justify-between gap-3 py-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="text-cyan-400 font-semibold">[{h.fromStepId}]</span>
                  <span className="text-slate-400 font-medium">{h.tool}</span>
                  <span className="text-slate-300">{h.finding}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {h.primaryFact && (
                    <span className="text-emerald-400 bg-emerald-950/60 px-1 py-0.2 rounded border border-emerald-900/50">
                      {h.primaryFact.key}={h.primaryFact.value}
                    </span>
                  )}
                  {h.refKey && (
                    <button
                      type="button"
                      onClick={() => handleInspectRef(h.refKey!)}
                      className="text-sky-300 hover:text-sky-100 underline cursor-pointer"
                    >
                      [{h.refKey}]
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
