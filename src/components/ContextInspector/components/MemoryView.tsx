import React, { useState } from "react";
import type { TaskMemory, Step } from "../../../core/types.ts";
import { Terminal, Database, AlertOctagon, Sparkles, BookOpen, ExternalLink, Copy, Check } from "lucide-react";

interface MemoryViewProps {
  memory?: TaskMemory;
  steps?: Step[];
  taskId?: string;
  onInspectRef?: (refKey: string) => void;
}

export const MemoryView: React.FC<MemoryViewProps> = ({
  memory,
  steps = [],
  taskId: _taskId,
  onInspectRef,
}) => {
  const [copiedFactKey, setCopiedFactKey] = useState<string | null>(null);
  const [showAllLog, setShowAllLog] = useState<boolean>(false);

  if (!memory) {
    return (
      <div className="py-6 text-center text-slate-500 font-mono text-xs">
        No hay registros en la memoria operativa de la tarea.
      </div>
    );
  }

  const { log = [], facts = {}, fail = [], effects = [] } = memory;
  const factsEntries = Object.entries(facts);

  // Extraer handoffs y referencias de los pasos
  const handoffs = steps
    .filter((s) => Boolean(s.handoff))
    .map((s) => s.handoff!);

  const normalizeRefKey = (k: string): string => k.replace(/^ref:/, "").trim();

  // Extraer todas las claves ref mencionadas
  const collectedRefKeys = Array.from(
    new Set([
      ...handoffs.filter((h) => Boolean(h.refKey)).map((h) => normalizeRefKey(h.refKey!)),
      ...Object.values(facts)
        .flatMap((v) => (v.match(/(?:ref:)?r\w+/g) || []))
        .map(normalizeRefKey),
      ...effects
        .flatMap((e) => (e.match(/(?:ref:)?r\w+/g) || []))
        .map(normalizeRefKey),
      ...log
        .flatMap((l) => (l.match(/(?:ref:)?r\w+/g) || []))
        .map(normalizeRefKey),
    ])
  ).filter((k) => /^r\w+$/.test(k));

  const handleCopyFact = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(`${key}: ${val}`);
      setCopiedFactKey(key);
      setTimeout(() => setCopiedFactKey(null), 2000);
    } catch (err) {
      console.error("Error al copiar hecho:", err);
    }
  };

  const displayedLog = showAllLog ? log : log.slice(-10);

  return (
    <div className="flex flex-col divide-y divide-slate-800/60 font-mono text-xs">
      {/* 1. HECHOS CONFIRMADOS (FACTS) */}
      <section className="pb-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between text-slate-400 font-semibold text-[11px] uppercase tracking-wider">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <Database className="w-3.5 h-3.5 shrink-0" />
            <span>Hechos Confirmados (FACTS)</span>
            <span className="text-slate-500 font-normal">({factsEntries.length})</span>
          </div>
          {collectedRefKeys.length > 0 && onInspectRef && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-500 text-[10px] lowercase">refstore:</span>
              {collectedRefKeys.map((rk) => (
                <button
                  key={`ref-pill-${rk}`}
                  type="button"
                  onClick={() => onInspectRef(rk)}
                  className="px-1.5 py-0.5 rounded bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-800/70 text-[10px] cursor-pointer transition-colors flex items-center gap-1"
                  title={`Inspeccionar contenido de ref:${rk}`}
                >
                  <span>ref:{rk}</span>
                  <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                </button>
              ))}
            </div>
          )}
        </div>

        {factsEntries.length === 0 ? (
          <p className="text-slate-600 text-xs italic py-1">Sin hechos registrados aún.</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-800/40">
            {factsEntries.map(([k, v]) => {
              const refMatches = Array.from(new Set(v.match(/(?:ref:)?r\w+/g) || [])).map(normalizeRefKey);
              return (
                <div key={`fact-${k}`} className="py-1.5 flex items-start justify-between gap-3 group">
                  <div className="flex items-baseline gap-2 flex-1 min-w-0 flex-wrap sm:flex-nowrap">
                    <span className="text-emerald-400 font-medium text-[11px] w-28 sm:w-36 shrink-0 truncate" title={k}>
                      {k}
                    </span>
                    <span className="text-slate-200 text-xs break-all flex-1">
                      {v}
                    </span>
                    {refMatches.length > 0 && onInspectRef && (
                      <span className="flex items-center gap-1 shrink-0">
                        {refMatches.map((rk) => (
                          <button
                            key={`fact-ref-${k}-${rk}`}
                            type="button"
                            onClick={() => onInspectRef(rk)}
                            className="px-1.5 py-0.2 rounded bg-sky-950/70 hover:bg-sky-900/80 text-sky-300 border border-sky-800/60 text-[10px] cursor-pointer transition-colors inline-flex items-center gap-0.5"
                          >
                            <span>ref:{rk}</span>
                            <ExternalLink className="w-2 h-2" />
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyFact(k, v)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-white shrink-0 cursor-pointer"
                    title="Copiar hecho"
                    aria-label={`Copiar hecho ${k}`}
                  >
                    {copiedFactKey === k ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. ALERTAS DE FALLO (FAIL) - Condicional, solo si existen */}
      {fail.length > 0 && (
        <section className="py-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-rose-400 font-semibold text-[11px] uppercase tracking-wider">
            <AlertOctagon className="w-3.5 h-3.5 shrink-0" />
            <span>Alertas de Fallo Registradas (FAIL)</span>
            <span className="text-rose-500 font-normal">({fail.length})</span>
          </div>
          <div className="flex flex-col gap-1">
            {fail.map((entry, idx) => (
              <div key={`fail-${idx}`} className="text-rose-300/90 text-xs leading-relaxed flex items-start gap-2">
                <span className="text-rose-500 shrink-0 select-none">⚠</span>
                <span className="break-all">{entry}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. EFECTOS MUTATIVOS EN EL ENTORNO (EFFECTS) - Condicional */}
      {effects.length > 0 && (
        <section className="py-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-indigo-400 font-semibold text-[11px] uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Efectos Secundarios en el Entorno (EFFECTS)</span>
            <span className="text-indigo-500 font-normal">({effects.length})</span>
          </div>
          <div className="flex flex-col gap-1">
            {effects.map((eff, idx) => (
              <div key={`eff-${idx}`} className="text-indigo-200/90 text-xs leading-relaxed flex items-start gap-2">
                <span className="text-indigo-400 shrink-0 select-none">⚡</span>
                <span className="break-all">{eff}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. LEDGER DE TRANSFERENCIAS (HANDOFFS) */}
      {handoffs.length > 0 && (
        <section className="py-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-cyan-400 font-semibold text-[11px] uppercase tracking-wider">
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            <span>Transferencias entre Etapas (Handoffs)</span>
            <span className="text-cyan-500 font-normal">({handoffs.length})</span>
          </div>
          <div className="flex flex-col divide-y divide-slate-800/40">
            {handoffs.map((h, hIdx) => (
              <div key={`handoff-${h.fromStepId}-${hIdx}`} className="py-1.5 flex items-start justify-between gap-3 text-xs">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-cyan-400 font-semibold shrink-0">[{h.fromStepId}]</span>
                  <span className="text-slate-400 font-medium shrink-0">{h.tool}:</span>
                  <span className="text-slate-200 break-all">{h.finding}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {h.primaryFact && (
                    <span className="text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-900/50 text-[10px]">
                      {h.primaryFact.key}={h.primaryFact.value}
                    </span>
                  )}
                  {h.refKey && onInspectRef && (
                    <button
                      type="button"
                      onClick={() => onInspectRef(h.refKey!)}
                      className="text-sky-300 hover:text-sky-100 underline cursor-pointer text-[10px]"
                    >
                      [ref:{normalizeRefKey(h.refKey!)}]
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. BITÁCORA OPERATIVA (LOG) */}
      <section className="pt-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-slate-400 font-semibold text-[11px] uppercase tracking-wider">
          <div className="flex items-center gap-1.5 text-sky-400">
            <Terminal className="w-3.5 h-3.5 shrink-0" />
            <span>Bitácora Operativa (LOG)</span>
            <span className="text-slate-500 font-normal">({log.length} líneas)</span>
          </div>
          {log.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAllLog(!showAllLog)}
              className="text-slate-400 hover:text-white text-[10px] font-normal cursor-pointer transition-colors"
            >
              {showAllLog ? "Mostrar últimas 10" : `Ver todas (${log.length})`}
            </button>
          )}
        </div>

        {log.length === 0 ? (
          <p className="text-slate-600 text-xs italic py-1">Sin entradas de log registradas.</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-800/40 text-xs">
            {displayedLog.map((line, idx) => {
              const parts = line.split("|");
              const seq = parts[0] || String(idx + 1);
              const tool = parts[1] || "";
              const status = parts[2] || "ok";
              const finding = parts.slice(3).join("|") || line;

              const statusColor =
                status === "ok"
                  ? "text-emerald-400"
                  : status === "err"
                  ? "text-rose-400 font-semibold"
                  : status === "nf"
                  ? "text-amber-400"
                  : "text-slate-400";

              return (
                <div key={`log-${idx}-${seq}`} className="flex items-baseline gap-2 py-1 hover:bg-slate-900/30 px-1 rounded transition-colors">
                  <span className="text-slate-500 shrink-0 tabular-nums w-6">#{seq}</span>
                  <span className="text-sky-300 font-medium shrink-0">{tool}</span>
                  <span className={`${statusColor} shrink-0 text-[11px]`}>[{status}]</span>
                  <span className="text-slate-300 break-all flex-1">{finding}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
